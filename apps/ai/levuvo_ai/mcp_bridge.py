"""Stdio bridge for MCP clients that start a command (Claude Desktop and others).

``python -m levuvo_ai.mcp_bridge --port 7341`` reads JSON-RPC lines on standard input, forwards them to
Levuvo Mail's local MCP endpoint (``http://127.0.0.1:<port>/mcp``) with the token from the environment
variable ``LEVUVO_MCP_TOKEN`` and writes the answers to standard output. Standard library only; no
proxy is used and nothing but 127.0.0.1 is contacted.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any
from urllib import error, request

MAX_LINE = 8 * 1024 * 1024


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="levuvo_ai.mcp_bridge")
    parser.add_argument("--port", type=int, default=7341)
    args = parser.parse_args(argv)
    token = os.environ.get("LEVUVO_MCP_TOKEN", "")
    if not token:
        print("levuvo-mcp: LEVUVO_MCP_TOKEN is not set", file=sys.stderr)
        return 2
    url = f"http://127.0.0.1:{args.port}/mcp"
    opener = request.build_opener(request.ProxyHandler({}))
    session: str | None = None
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        if len(raw) > MAX_LINE or not raw.strip():
            continue
        try:
            message: Any = json.loads(raw)
        except ValueError:
            continue
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
        }
        if session:
            headers["Mcp-Session-Id"] = session
        req = request.Request(url, data=json.dumps(message).encode("utf-8"), headers=headers, method="POST")
        reply: Any = None
        try:
            with opener.open(req, timeout=900) as response:
                session = response.headers.get("Mcp-Session-Id") or session
                body = response.read(MAX_LINE)
                reply = json.loads(body) if body else None
        except error.HTTPError as exc:
            text = "Levuvo Mail refused the token." if exc.code == 401 else f"Levuvo Mail answered HTTP {exc.code}."
            reply = _error(message, text)
        except (error.URLError, OSError, ValueError):
            reply = _error(message, "Levuvo Mail is not running or its MCP server is switched off.")
        if reply is not None:
            out.write(json.dumps(reply, ensure_ascii=False).encode("utf-8") + b"\n")
            out.flush()
    return 0


def _error(message: Any, text: str) -> dict[str, Any] | None:
    ident = message.get("id") if isinstance(message, dict) else None
    if ident is None:
        return None
    return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32000, "message": text}}


if __name__ == "__main__":
    raise SystemExit(main())
