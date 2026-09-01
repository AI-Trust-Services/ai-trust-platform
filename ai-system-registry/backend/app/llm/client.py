"""LLM client — provider dispatch with a uniform return shape.

Async port of the sync reference adapter (test/toxicity-check/client_app/llm_client.py),
adapted to repo conventions: async, ai_trust_logging, a `stub` provider for tests/CI,
and split model roles (LLM_MODEL for text/JSON, LLM_VISION_MODEL for images).

Providers, switched by llm.provider setting:
  - ``stub``     — deterministic canned responses (default everywhere; no network)
  - ``ollama``   — OpenAI-compatible endpoint via the async ``openai`` SDK
  - ``external`` — external provider (OAuth2 client-credentials + Anthropic-format /invoke)

All providers return: ``{text, input_tokens, output_tokens, finish_reason}``.

Configuration is loaded from the database (platform_settings table) via the settings service,
with automatic fallback to environment variables when database values are null.

Multi-tenant aware: config is cached per-tenant using the tenant_id from context.
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass
from typing import Any

import httpx

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.settings_service import get_setting

logger = get_logger(__name__)


def _get_tenant_id() -> str:
    """Get current tenant ID for cache keying. Returns 'default' in single-tenant mode."""
    try:
        from ai_trust_tenancy.context import tenant_id_var
        return tenant_id_var.get() or "default"
    except ImportError:
        # Tenancy lib not installed (e.g., in tests)
        return "default"


class LLMResponseError(Exception):
    """Raised when the external provider returns an unexpected response shape."""


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class LLMConfig:
    """Immutable snapshot of LLM configuration."""

    provider: str
    base_url: str
    api_key: str
    model: str
    vision_model: str
    # External provider fields
    client_id: str | None
    client_secret: str | None
    auth_url: str | None
    api_url: str
    resource_group: str
    deployment_id: str
    api_version: str

    def config_hash(self) -> str:
        """Hash for detecting config changes affecting connections."""
        key_fields = f"{self.provider}|{self.base_url}|{self.api_key}|{self.client_id}|{self.auth_url}"
        return hashlib.md5(key_fields.encode()).hexdigest()[:8]


# Config cache (separate from settings_service cache for quick access within burst requests)
# Keyed by tenant_id for multi-tenant isolation
_config_cache: dict[str, tuple[LLMConfig, float]] = {}
_CONFIG_CACHE_TTL = 60.0  # Match settings_service TTL


async def _load_config() -> LLMConfig:
    """Load LLM configuration from database with env var fallback.

    The settings_service.get_setting() function automatically falls back to
    environment variables when database values are null. For example,
    "llm.provider" falls back to LLM_PROVIDER env var.

    Multi-tenant aware: caches config per-tenant using tenant_id from context.
    """
    global _config_cache

    tenant_id = _get_tenant_id()
    now = time.time()

    if tenant_id in _config_cache:
        config, cache_time = _config_cache[tenant_id]
        if (now - cache_time) < _CONFIG_CACHE_TTL:
            return config

    async with SessionLocal() as session:
        config = LLMConfig(
            provider=await get_setting(session, "llm.provider", default="stub"),
            base_url=await get_setting(session, "llm.base_url", default="http://ollama:11434/v1"),
            api_key=await get_setting(session, "llm.api_key", default="ollama"),
            model=await get_setting(session, "llm.model", default="llama3.2"),
            vision_model=await get_setting(session, "llm.vision_model", default="llama3.2-vision"),
            client_id=await get_setting(session, "ai.client_id"),
            client_secret=await get_setting(session, "ai.client_secret"),
            auth_url=await get_setting(session, "ai.auth_url"),
            api_url=(await get_setting(session, "ai.api_url", default="") or "").rstrip("/"),
            resource_group=await get_setting(session, "ai.resource_group", default="default"),
            deployment_id=await get_setting(session, "ai.deployment_id", default=""),
            api_version=await get_setting(session, "ai.api_version", default="bedrock-2023-05-31"),
        )

    _config_cache[tenant_id] = (config, now)
    logger.debug("llm.config_loaded", extra={"provider": config.provider, "model": config.model, "tenant": tenant_id})
    return config


def invalidate_config_cache(tenant_id: str | None = None) -> None:
    """Invalidate the config cache. Call after settings change for immediate effect.

    Args:
        tenant_id: Specific tenant to invalidate, or None to invalidate all tenants.
    """
    global _config_cache, _external_validated, _token_cache

    if tenant_id is None:
        _config_cache.clear()
        _external_validated.clear()
        _token_cache.clear()
    else:
        _config_cache.pop(tenant_id, None)
        _external_validated.discard(tenant_id)
        _token_cache.pop(tenant_id, None)

    logger.info("llm.config_cache_invalidated", extra={"tenant": tenant_id or "all"})


# ---------------------------------------------------------------------------
# External provider validation (lazy, on first use)
# ---------------------------------------------------------------------------

# Tracks which tenants have had their external config validated
_external_validated: set[str] = set()


def _validate_external_config(config: LLMConfig) -> None:
    """Validate external provider config, raising RuntimeError if incomplete."""
    global _external_validated
    tenant_id = _get_tenant_id()
    if tenant_id in _external_validated:
        return

    missing = [
        name
        for name, value in [
            ("ai.client_id", config.client_id),
            ("ai.client_secret", config.client_secret),
            ("ai.auth_url", config.auth_url),
            ("ai.api_url", config.api_url),
            ("ai.deployment_id", config.deployment_id),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"LLM provider=external but required settings are unset: {', '.join(missing)}. "
            "Configure them in Admin UI or set env vars, or switch to provider=stub/ollama."
        )
    _external_validated.add(tenant_id)


# ---------------------------------------------------------------------------
# OpenAI-compatible backend (ollama, vLLM, or any /v1/chat/completions endpoint)
# ---------------------------------------------------------------------------

_openai_client: Any = None  # AsyncOpenAI singleton — reuses the connection pool across calls
_openai_config_hash: str = ""


async def _chat_completions(
    messages: list[dict],
    model: str,
    max_tokens: int,
    json_mode: bool,
    config: LLMConfig,
) -> dict:
    global _openai_client, _openai_config_hash
    from openai import AsyncOpenAI

    # Recreate client if config changed (different base_url or api_key)
    new_hash = config.config_hash()
    if _openai_client is None or _openai_config_hash != new_hash:
        _openai_client = AsyncOpenAI(base_url=config.base_url, api_key=config.api_key)
        _openai_config_hash = new_hash
        logger.info("llm.openai_client_created", extra={"config_hash": new_hash, "base_url": config.base_url})

    kwargs: dict[str, Any] = {"model": model, "messages": messages, "max_tokens": max_tokens}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = await _openai_client.chat.completions.create(**kwargs)
    usage = response.usage
    return {
        "text": response.choices[0].message.content or "",
        "input_tokens": usage.prompt_tokens if usage else 0,
        "output_tokens": usage.completion_tokens if usage else 0,
        "finish_reason": response.choices[0].finish_reason or "stop",
    }


# ---------------------------------------------------------------------------
# External LLM backend (OAuth2 + Anthropic-format /invoke endpoint)
# ---------------------------------------------------------------------------

# Per-tenant token cache: tenant_id -> (token, expiry, config_hash)
_token_cache: dict[str, tuple[str, float, str]] = {}
_token_lock = asyncio.Lock()


async def _get_token(config: LLMConfig) -> str:
    global _token_cache
    tenant_id = _get_tenant_id()

    async with _token_lock:
        new_hash = config.config_hash()

        # Check if we have a valid cached token for this tenant
        if tenant_id in _token_cache:
            token, expiry, cached_hash = _token_cache[tenant_id]
            # Invalidate if credentials changed or token expired
            if cached_hash == new_hash and time.monotonic() < expiry - 60:
                return token

        # Fetch new token
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                config.auth_url,
                data={"grant_type": "client_credentials"},
                auth=(config.client_id, config.client_secret),
            )
        resp.raise_for_status()
        data = resp.json()
        token = data["access_token"]
        expiry = time.monotonic() + data.get("expires_in", 43200)
        _token_cache[tenant_id] = (token, expiry, new_hash)
        logger.info("llm.token_refreshed", extra={"expires_in": data.get("expires_in", 43200), "tenant": tenant_id})
        return token


_EXTERNAL_TIMEOUT = 180
_EXTERNAL_RETRIES = 2


async def _chat_external(
    messages: list[dict],
    model: str,
    max_tokens: int,
    config: LLMConfig,
) -> dict:
    token = await _get_token(config)
    url = f"{config.api_url}/v2/inference/deployments/{config.deployment_id}/invoke"
    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    convo = [m for m in messages if m["role"] != "system"]
    # Anthropic API requires messages to start and end with a user turn.
    # Strip leading assistant messages (e.g. initial bot greeting) and trailing
    # assistant messages (e.g. extraction summary added before the next turn).
    while convo and convo[0]["role"] != "user":
        convo = convo[1:]
    while convo and convo[-1]["role"] != "user":
        convo = convo[:-1]
    if not convo:
        convo = [{"role": "user", "content": "(start)"}]
    body: dict[str, Any] = {
        "anthropic_version": config.api_version,
        "max_tokens": max_tokens,
        "messages": convo,
    }
    if system_parts:
        body["system"] = "\n\n".join(system_parts)

    last_exc: Exception | None = None
    for attempt in range(1 + _EXTERNAL_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=_EXTERNAL_TIMEOUT) as client:
                resp = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "AI-Resource-Group": config.resource_group,
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("content")
            if not isinstance(content, list) or not content:
                raise LLMResponseError(
                    f"External provider returned unexpected shape — keys: {list(data.keys())}"
                )
            return {
                "text": content[0].get("text", ""),
                "input_tokens": data.get("usage", {}).get("input_tokens", 0),
                "output_tokens": data.get("usage", {}).get("output_tokens", 0),
                "finish_reason": data.get("stop_reason") or "end_turn",
            }
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            last_exc = exc
            if attempt < _EXTERNAL_RETRIES:
                wait = 2**attempt
                logger.warning(
                    "llm.external_retry",
                    extra={"attempt": attempt + 1, "wait_s": wait, "error": str(exc)},
                )
                await asyncio.sleep(wait)
            else:
                raise
    raise last_exc  # unreachable, satisfies type checkers


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------


async def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    max_tokens: int = 1024,
    json_mode: bool = False,
    task: str = "chat",
) -> dict:
    """Call the configured LLM and return {text, input_tokens, output_tokens, finish_reason}.

    Configuration is loaded from database settings (with env var fallback).
    ``model`` defaults to the configured LLM model; callers pass the vision model for images.
    ``task`` is used only for logging/stub dispatch.
    """
    config = await _load_config()
    model = model or config.model

    try:
        if config.provider == "stub":
            from app.llm import stub

            result = stub.chat(messages, task=task)
        elif config.provider == "external":
            _validate_external_config(config)
            result = await _chat_external(messages, model, max_tokens, config)
        else:  # ollama / OpenAI-compatible
            result = await _chat_completions(messages, model, max_tokens, json_mode, config)
    except Exception as exc:
        logger.error(
            "llm.request_failed",
            extra={"provider": config.provider, "model": model, "task": task, "error": str(exc)},
        )
        raise

    logger.info(
        "llm.request",
        extra={
            "provider": config.provider,
            "model": model,
            "task": task,
            "input_tokens": result.get("input_tokens", 0),
            "output_tokens": result.get("output_tokens", 0),
        },
    )
    return result


async def get_vision_model() -> str:
    """Get the configured vision model name."""
    config = await _load_config()
    return config.vision_model


async def get_model() -> str:
    """Get the configured default model name."""
    config = await _load_config()
    return config.model
