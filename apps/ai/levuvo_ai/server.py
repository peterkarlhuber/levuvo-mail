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
from typing import IO, Any

MAX_LINE = 8 * 1024 * 1024

Handler = Callable[[dict[str, Any]], Any]


class RpcError(Exception):
    """An error with a stable ``kind`` the UI can translate; the message never contains mail content."""

    def __init__(self, kind: str, message: str = "") -> None:
        super().__init__(message or kind)
        self.kind = kind


def classify(exc: BaseException) -> RpcError:
    """Maps library errors to stable kinds without leaking prompts, keys or mail content."""
    if isinstance(exc, RpcError):
        return exc
    name = type(exc).__name__
    kinds = {
        "ProviderConnectionError": "unreachable",
        "AuthenticationError": "auth",
        "MissingCredentialsError": "auth",
        "RateLimitError": "rate_limit",
        "StructuredOutputError": "invalid_output",
        "IncompleteResponseError": "too_long",
        "RefusalError": "refused",
        "UnsupportedCapabilityError": "unsupported",
        "UnknownCapabilityError": "unsupported",
        "MaxToolRoundsError": "too_many_steps",
        "MaxToolCallsError": "too_many_steps",
        "MCPError": "agent_tools",
        "TimeoutError": "timeout",
        "ValidationError": "invalid_input",
    }
    if name in kinds:
        return RpcError(kinds[name])
    if name == "OllamaError":
        code = str(getattr(exc, "code", "") or "ollama")
        return RpcError("model_missing" if code in ("model_not_found", "not_found") else code)
    if isinstance(exc, ValueError):
        return RpcError("invalid_input", str(exc)[:200])
    return RpcError("internal")


class Server:
    """Dispatches JSON-RPC requests to handlers."""

    def __init__(self, handlers: dict[str, Handler], output: IO[bytes], *, workers: int = 4) -> None:
        self.handlers = handlers
        self.output = output
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="levuvo-ai")

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
            self.pool.submit(self.handle, message)
        self.pool.shutdown(wait=False, cancel_futures=True)
