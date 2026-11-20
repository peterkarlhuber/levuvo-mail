"""Newline-delimited JSON-RPC 2.0 over standard input and output.

The Levuvo Mail server (Node.js) starts this process and is its only peer. Every request runs in a
worker thread; responses are written as soon as they are ready, so a slow model call does not block
a quick status request. Nothing but protocol messages is ever written to standard output: stray
``print`` calls go to standard error.
"""

from __future__ import annotations

import json
import sys
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import IO, Any

MAX_LINE = 8 * 1024 * 1024

Handler = Callable[[dict[str, Any]], Any]


class RpcError(Exception):
    """An error with a stable ``kind`` the UI can translate; the message never contains mail content."""

    def __init__(self, kind: str, message: str = "") -> None:
        super().__init__(message or kind)
        self.kind = kind


# Ollama codes passed on unchanged; the rest of OllamaError's codes collapse into these kinds.
_OLLAMA_CODES = {
    "model_missing": "model_missing",
    "model_not_found": "model_missing",
    "not_found": "model_missing",
    "unreachable": "unreachable",
    "timeout": "timeout",
    "disk_full": "disk_full",
    "network": "network",
    "input_too_long": "input_too_long",
    "not_embedding_model": "not_embedding_model",
    "empty_input": "invalid_input",
    "invalid_response": "invalid_output",
    "too_large": "invalid_output",
    "too_many_inputs": "invalid_input",
}


def _orkexa_kinds() -> list[tuple[type[BaseException], str]]:
    """Orkexa's error classes in matching order: subclasses before their base classes."""
    try:
        from orkexa import errors as e
        from orkexa.local import OllamaError
        from orkexa.mcp import MCPError
    except ImportError:  # pragma: no cover - broken installation
        return []
    return [
        (OllamaError, "ollama"),  # mapped by its code below (EmbeddingError is a subclass)
        (e.MissingCredentialsError, "auth"),
        (e.AuthenticationError, "auth"),
        (e.RateLimitError, "rate_limit"),
        (e.ProviderConnectionError, "unreachable"),
        (e.ProviderServerError, "unavailable"),
        (e.InvalidRequestError, "invalid_input"),
        (e.ProviderError, "unavailable"),
        (e.StructuredOutputError, "invalid_output"),
        (e.UnexpectedResponseError, "invalid_output"),
        (e.IncompleteResponseError, "too_long"),
        (e.RefusalError, "refused"),
        (e.UnsupportedCapabilityError, "unsupported"),  # includes UnknownCapabilityError
        (e.MaxToolRoundsError, "too_many_steps"),  # includes MaxToolCallsError
        (MCPError, "agent_tools"),
    ]


_KINDS: list[tuple[type[BaseException], str]] | None = None


def _timed_out(exc: BaseException) -> bool:
    seen: BaseException | None = exc
    for _ in range(5):
        if seen is None:
            break
        if isinstance(seen, TimeoutError) or "timeout" in type(seen).__name__.lower():
            return True
        seen = seen.__cause__ or seen.__context__
    return "did not answer in time" in str(exc)


def classify(exc: BaseException) -> RpcError:
    """Maps library errors to stable kinds without leaking prompts, keys or mail content.

    Matched by type (``isinstance``), so subclasses Orkexa adds later land in the kind of their family
    instead of ``internal``. Every kind is listed in ``error_kinds.json``; the UI has a text for each.
    """
    global _KINDS
    if isinstance(exc, RpcError):
        return exc
    if _KINDS is None:
        _KINDS = _orkexa_kinds()
    for cls, kind in _KINDS:
        if isinstance(exc, cls):
            # A model that answers too slowly is reported by Orkexa as a connection error; the user
            # should read "took too long", not "is Ollama running?" (seen with a 3B model on a CPU).
            if kind == "unreachable" and _timed_out(exc):
                return RpcError("timeout")
            if kind == "ollama":
                return RpcError(_OLLAMA_CODES.get(str(getattr(exc, "code", "") or ""), "ollama"))
            return RpcError(kind)
    if isinstance(exc, TimeoutError):
        return RpcError("timeout")
    # pydantic.ValidationError is a ValueError: invalid input from the Node side.
    if isinstance(exc, ValueError):
        return RpcError("invalid_input")  # no message: it may quote mail content
    return RpcError("internal")


ERROR_KINDS_FILE = Path(__file__).with_name("error_kinds.json")


# Quick requests with their own short timeouts. They run apart from model calls, so a pool full of
# slow or hanging model calls never makes "status" or "configure" time out.
CONTROL_METHODS = frozenset({"status", "configure", "models"})


class Server:
    """Dispatches JSON-RPC requests to handlers."""

    def __init__(self, handlers: dict[str, Handler], output: IO[bytes], *, workers: int = 4) -> None:
        self.handlers = handlers
        self.output = output
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="levuvo-ai")
        self.control = ThreadPoolExecutor(max_workers=2, thread_name_prefix="levuvo-ai-control")

    def send(self, message: dict[str, Any]) -> None:
        data = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        with self.lock:
            self.output.write(data)
            self.output.flush()

    def handle(self, message: dict[str, Any]) -> None:
        ident = message.get("id")
        method = message.get("method")
        params = message.get("params") if isinstance(message.get("params"), dict) else {}
        handler = self.handlers.get(method) if isinstance(method, str) else None
        if handler is None:
            if ident is not None:
                self.send({"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": "unknown method"}})
            return
        try:
            result = handler(params)
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            err = classify(exc)
            print(f"levuvo-ai: {method} failed: {type(exc).__name__}", file=sys.stderr)
            if ident is not None:
                self.send(
                    {
                        "jsonrpc": "2.0",
                        "id": ident,
                        "error": {"code": -32000, "message": str(err), "data": {"kind": err.kind}},
                    }
                )
            return
        if ident is not None:
            self.send({"jsonrpc": "2.0", "id": ident, "result": result})

    def serve(self, stream: IO[bytes]) -> None:
        while True:
            line = stream.readline(MAX_LINE + 1)
            if not line:
                break
            if len(line) > MAX_LINE:
                print("levuvo-ai: request too large, stopping", file=sys.stderr)
                break
            if not line.strip():
                continue
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("method") == "shutdown":
                if message.get("id") is not None:
                    self.send({"jsonrpc": "2.0", "id": message["id"], "result": {"ok": True}})
                break
            pool = self.control if message.get("method") in CONTROL_METHODS else self.pool
            pool.submit(self.handle, message)
        self.pool.shutdown(wait=False, cancel_futures=True)
        self.control.shutdown(wait=False, cancel_futures=True)
