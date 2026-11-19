"""Model configuration and agent construction on Orkexa.

The default and recommended provider is a local Ollama server on a loopback address. Cloud providers are
only used when the Node side passes ``provider`` together with an API key from the system keychain, which
it does only after the user consented for that provider. The key lives in memory only.
"""

from __future__ import annotations

import ipaddress
import threading
from dataclasses import dataclass, replace
from typing import Any
from urllib.parse import urlsplit

from .server import RpcError

PROVIDERS = ("ollama", "anthropic", "openai")
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODELS = {"ollama": "qwen3.5:9b", "anthropic": "claude-sonnet-5-5", "openai": "gpt-5.5-mini"}
DEFAULT_EMBED_MODEL = "qwen3-embedding:0.6b"
THINKING = ("auto", "off", "low", "medium", "high")


def is_cloud_model(name: str) -> bool:
    """Ollama models that run on Ollama's cloud service: tag ``cloud`` or ending in ``-cloud``
    (``gpt-oss:120b-cloud``). Their content leaves the device, so the local provider refuses them."""
    tag = name.strip().rsplit("/", 1)[-1].rpartition(":")[2].lower()
    return tag == "cloud" or tag.endswith("-cloud")


def loopback_url(url: str) -> str:
    """Accepts only http://loopback[:port] (Ollama has no authentication, so no remote host)."""
    parts = urlsplit(url.strip().rstrip("/"))
    host = parts.hostname or ""
    if parts.scheme != "http" or parts.username or parts.password or parts.path not in ("", "/v1"):
        raise RpcError("invalid_input", "Ollama URL must be http://127.0.0.1:<port>")
    try:
        loop = host == "localhost" or ipaddress.ip_address(host).is_loopback
    except ValueError:
        loop = False
    if not loop:
        raise RpcError("invalid_input", "Ollama must run on this computer (loopback address)")
    return f"http://{parts.netloc}"


@dataclass(frozen=True)
class Config:
    provider: str = "ollama"
    model: str = DEFAULT_MODELS["ollama"]
    base_url: str = DEFAULT_OLLAMA_URL
    embed_model: str = DEFAULT_EMBED_MODEL
    api_key: str = ""
    timeout: float = 180.0
    # The user's advanced settings for this model (Settings → KI & Agenten → Erweitert); None is automatic.
    max_tokens: int | None = None
    temperature: float | None = None
    thinking: str = "auto"

    def public(self) -> dict[str, Any]:
        """The configuration without the key."""
        return {
            "provider": self.provider,
            "model": self.model,
            "baseUrl": self.base_url,
            "embedModel": self.embed_model,
            "hasKey": bool(self.api_key),
            "options": {"maxTokens": self.max_tokens, "temperature": self.temperature, "thinking": self.thinking},
        }


class Engine:
    """Holds the active configuration and builds agents for it."""

    def __init__(self) -> None:
        self._config = Config()
        self._lock = threading.Lock()
        self._caps: dict[str, dict[str, str]] = {}

    @property
    def config(self) -> Config:
        with self._lock:
            return self._config

    def configure(self, params: dict[str, Any]) -> dict[str, Any]:
        provider = str(params.get("provider") or "ollama")
        if provider not in PROVIDERS:
            raise RpcError("invalid_input", "unknown provider")
        model = str(params.get("model") or DEFAULT_MODELS[provider]).strip()
        if not model or len(model) > 200 or any(c.isspace() for c in model):
            raise RpcError("invalid_input", "invalid model name")
        if provider == "ollama" and is_cloud_model(model):
            raise RpcError("invalid_input", "Ollama cloud models are not allowed: content would leave the device")
        api_key = str(params.get("apiKey") or "")
        if provider != "ollama" and not api_key:
            raise RpcError("auth", "an API key is required for a cloud provider")
        base_url = loopback_url(str(params.get("baseUrl") or DEFAULT_OLLAMA_URL))
        embed = str(params.get("embedModel") or DEFAULT_EMBED_MODEL).strip()
        if is_cloud_model(embed):
            raise RpcError("invalid_input", "Ollama cloud models are not allowed: content would leave the device")
        opts = params.get("options") if isinstance(params.get("options"), dict) else {}
        max_tokens = opts.get("maxTokens")
        if max_tokens is not None and not (isinstance(max_tokens, int) and 256 <= max_tokens <= 16384):
            raise RpcError("invalid_input", "maxTokens out of range")
        temperature = opts.get("temperature")
        if temperature is not None and not (isinstance(temperature, (int, float)) and 0 <= temperature <= 2):
            raise RpcError("invalid_input", "temperature out of range")
        thinking = str(opts.get("thinking") or "auto")
        if thinking not in THINKING:
            raise RpcError("invalid_input", "unknown thinking level")
        with self._lock:
            self._config = replace(
                self._config,
                max_tokens=max_tokens,
                temperature=float(temperature) if temperature is not None and provider == "ollama" else None,
                thinking=thinking,
                provider=provider,
                model=model,
                base_url=base_url,
                embed_model=embed,
                api_key=api_key if provider != "ollama" else "",
            )
            self._caps.clear()
            return self._config.public()

    def ollama(self, timeout: float = 30.0) -> Any:
        from orkexa.local import OllamaClient

        return OllamaClient(self.config.base_url, timeout=timeout)

    def _ollama_caps(self, model: str) -> dict[str, str]:
        """What the model can do, from ``/api/show``.

        Only an answer is cached. When Ollama cannot be asked (starting, loading the model), the
        fallback is used for this request only, so a short outage does not make every later agent run
        fail with ``unsupported`` until the next reconfiguration.
        """
        with self._lock:
            cached = self._caps.get(model)
        if cached is not None:
            return cached
        caps: dict[str, str] = {}
        try:
            details = self.ollama().show(model)
            caps.update(details.capability_overrides())
            # Not an Orkexa capability: whether the model thinks before answering (Qwen 3.5 does).
            caps["_thinking"] = "supported" if "thinking" in (details.capabilities or []) else "unsupported"
            known = True
        except Exception:
            caps["tools"] = "unknown"
            known = False
        # Ollama implements response_format/json_schema for every chat model.
        caps["structured_output"] = "supported"
        caps.setdefault("system_messages", "supported")
        if known:
            with self._lock:
                self._caps[model] = caps
        return caps

    def agent(
        self,
        *,
        system: str,
        output_format: Any = None,
        tools: list[Any] | None = None,
        before_tool: Any = None,
        max_tokens: int = 1500,
        max_tool_rounds: int = 8,
        temperature: float | None = None,
        think: bool = True,
        min_tokens: int | None = None,
    ) -> Any:
        """An agent for the active model.

        ``temperature`` and ``think=False`` apply to local models only: cloud reasoning models reject a
        temperature, and their thinking is set by the provider. ``think=False`` turns thinking off for a
        local model that thinks, so a short answer is not delayed (and its tokens not used up) by it.
        """
        from orkexa import Agent
        from orkexa.providers.options import CompatibleOptions

        cfg = self.config
        # The user's settings win over the defaults of a function; "auto" keeps them.
        if cfg.max_tokens is not None:
            max_tokens = cfg.max_tokens
        if min_tokens:  # "Länger antworten" after an answer was cut off
            max_tokens = max(max_tokens, min(int(min_tokens), 16384))
        if cfg.temperature is not None:
            temperature = cfg.temperature
        if cfg.thinking == "off":
            think = False
        common: dict[str, Any] = {
            "system_prompt": system,
            "output_format": output_format,
            "tools": tools or [],
            "before_tool": before_tool,
            "max_tokens": max_tokens,
            "max_tool_rounds": max_tool_rounds,
            "timeout": cfg.timeout,
            "max_retries": 1,
            "raise_tool_errors": False,
        }
        if cfg.provider == "ollama":
            caps = dict(self._ollama_caps(cfg.model))
            thinking = caps.pop("_thinking", "unknown") == "supported"
            if not tools:
                caps.pop("tools", None)
            request: dict[str, Any] = {}
            if temperature is not None:
                request["temperature"] = temperature
            if thinking and cfg.thinking in ("low", "medium", "high"):
                request["reasoning_effort"] = cfg.thinking
            elif thinking and not think:
                request["reasoning_effort"] = "none"
            if request:
                common["options"] = CompatibleOptions(request_options=request)
            return Agent(
                provider="ollama",
                model=cfg.model,
                base_url=f"{cfg.base_url}/v1",
                api_key="ollama",
                capabilities=caps,
                **common,
            )
        return Agent(model=f"{cfg.provider}:{cfg.model}", api_key=cfg.api_key, **common)

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embeddings always run locally on Ollama: the vectors describe the whole mailbox."""
        return list(self.ollama(timeout=120.0).embed(self.config.embed_model, texts).embeddings)
