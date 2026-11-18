"""Entry point: ``python -m levuvo_ai`` (started by the Levuvo Mail server, never by the user)."""

from __future__ import annotations

import os
import sys
from typing import Any

from . import __version__
from .engine import Engine
from .server import RpcError, Server


def build_handlers(engine: Engine) -> dict[str, Any]:
    from .agents import run_agent
    from .tasks import TASKS

    def status(_params: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {"version": __version__, "config": engine.config.public()}
        try:
            import orkexa

            out["orkexa"] = orkexa.__version__
        except ImportError:  # pragma: no cover - broken installation
            out["orkexa"] = None
        if engine.config.provider == "ollama" or _params.get("probeOllama"):
            try:
                client = engine.ollama(timeout=3.0)
                out["ollama"] = {"version": client.version(), "running": True}
            except Exception:
                out["ollama"] = {"running": False}
        return out

    def models(_params: dict[str, Any]) -> dict[str, Any]:
        listed = engine.ollama(timeout=5.0).list_models()
        return {
            "models": [
                {"name": m.name, "size": getattr(m, "size", None), "family": getattr(m, "family", None)}
                for m in listed
                if not str(m.name).endswith(":cloud")
            ]
        }

    def pull(params: dict[str, Any]) -> dict[str, Any]:
        name = str(params.get("model") or "")
        if not name or name.endswith(":cloud"):
            raise RpcError("invalid_input", "invalid model")
        last = ""
        for progress in engine.ollama(timeout=30.0).pull(name):
            last = progress.status
        return {"model": name, "status": last or "success"}

    def task(params: dict[str, Any]) -> Any:
        kind = str(params.get("kind") or "")
        fn = TASKS.get(kind)
        if fn is None:
            raise RpcError("invalid_input", "unknown task")
        payload = params.get("input") if isinstance(params.get("input"), dict) else {}
        return fn(engine, payload)

    return {
        "status": status,
        "configure": engine.configure,
        "models": models,
        "pull": pull,
        "task": task,
        "agent": lambda params: run_agent(engine, params),
    }


def main() -> None:
    # The protocol owns the real standard output; anything printed elsewhere goes to standard error.
    protocol_out = os.fdopen(os.dup(sys.stdout.fileno()), "wb", buffering=0)
    sys.stdout = sys.stderr
    engine = Engine()
    Server(build_handlers(engine), protocol_out).serve(sys.stdin.buffer)


if __name__ == "__main__":
    main()
