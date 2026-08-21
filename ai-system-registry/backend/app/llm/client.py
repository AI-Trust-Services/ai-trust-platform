"""LLM client — provider dispatch with a uniform return shape.

Async port of the sync reference adapter (test/toxicity-check/client_app/llm_client.py),
adapted to repo conventions: async, ai_trust_logging, a `stub` provider for tests/CI,
and split model roles (LLM_MODEL for text/JSON, LLM_VISION_MODEL for images).

Providers, switched by LLM_PROVIDER:
  - ``stub``     — deterministic canned responses (default everywhere; no network)
  - ``ollama``   — OpenAI-compatible endpoint via the async ``openai`` SDK
  - ``external`` — external provider (OAuth2 client-credentials + Anthropic-format /invoke)

All providers return: ``{text, input_tokens, output_tokens, finish_reason}``.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx

from ai_trust_logging import get_logger

logger = get_logger(__name__)


class LLMResponseError(Exception):
    """Raised when the external provider returns an unexpected response shape."""

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "stub")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://ollama:11434/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "ollama")
LLM_MODEL = os.environ.get("OLLAMA_CHAT_MODEL", os.environ.get("LLM_MODEL", "llama3.2"))
LLM_EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
LLM_VISION_MODEL = os.environ.get("LLM_VISION_MODEL", "llama3.2-vision")

AI_CLIENT_ID = os.environ.get("AI_CLIENT_ID")
AI_CLIENT_SECRET = os.environ.get("AI_CLIENT_SECRET")
AI_AUTH_URL = os.environ.get("AI_AUTH_URL")
AI_API_URL = os.environ.get("AI_API_URL", "").rstrip("/")
AI_RESOURCE_GROUP = os.environ.get("AI_RESOURCE_GROUP", "default")
AI_DEPLOYMENT_ID = os.environ.get("AI_DEPLOYMENT_ID", "")
AI_API_VERSION = os.environ.get("AI_API_VERSION", "bedrock-2023-05-31")

# Fail fast on misconfiguration: when the external backend is selected, all
# required credentials must be set — otherwise the first request dies deep
# inside httpx with an opaque error. Mirrors the repo os.environ[...] convention.
if LLM_PROVIDER == "external":
    _missing = [
        name
        for name, value in [
            ("AI_CLIENT_ID", AI_CLIENT_ID),
            ("AI_CLIENT_SECRET", AI_CLIENT_SECRET),
            ("AI_AUTH_URL", AI_AUTH_URL),
            ("AI_API_URL", AI_API_URL),
            ("AI_DEPLOYMENT_ID", AI_DEPLOYMENT_ID),
        ]
        if not value
    ]
    if _missing:
        raise RuntimeError(
            f"LLM_PROVIDER=external but required env vars are unset: {', '.join(_missing)}. "
            "Set them in .env or switch to LLM_PROVIDER=stub / ollama."
        )


# ---------------------------------------------------------------------------
# OpenAI-compatible backend (ollama, vLLM, or any /v1/chat/completions endpoint)
# ---------------------------------------------------------------------------

_openai_client: Any = None  # AsyncOpenAI singleton — reuses the connection pool across calls


async def _chat_completions(messages: list[dict], model: str, max_tokens: int, json_mode: bool) -> dict:
    global _openai_client
    from openai import AsyncOpenAI

    if _openai_client is None:
        _openai_client = AsyncOpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
    client = _openai_client
    kwargs: dict[str, Any] = {"model": model, "messages": messages, "max_tokens": max_tokens}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = await client.chat.completions.create(**kwargs)
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

_token: str | None = None
_token_expiry: float = 0.0
_token_lock = asyncio.Lock()


async def _get_token() -> str:
    global _token, _token_expiry
    async with _token_lock:
        if _token and time.monotonic() < _token_expiry - 60:
            return _token
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                AI_AUTH_URL,
                data={"grant_type": "client_credentials"},
                auth=(AI_CLIENT_ID, AI_CLIENT_SECRET),
            )
        resp.raise_for_status()
        data = resp.json()
        _token = data["access_token"]
        _token_expiry = time.monotonic() + data.get("expires_in", 43200)
        logger.info("llm.token_refreshed", extra={"expires_in": data.get("expires_in", 43200)})
        return _token


_EXTERNAL_TIMEOUT = 180
_EXTERNAL_RETRIES = 2


async def _chat_external(messages: list[dict], model: str, max_tokens: int) -> dict:
    token = await _get_token()
    url = f"{AI_API_URL}/v2/inference/deployments/{AI_DEPLOYMENT_ID}/invoke"
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
        "anthropic_version": AI_API_VERSION,
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
                        "AI-Resource-Group": AI_RESOURCE_GROUP,
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
                wait = 2 ** attempt
                logger.warning(
                    "llm.external_retry",
                    extra={"attempt": attempt + 1, "wait_s": wait, "error": str(exc)},
                )
                await asyncio.sleep(wait)
    raise last_exc


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

    ``model`` defaults to ``LLM_MODEL``; callers pass ``LLM_VISION_MODEL`` for images.
    ``task`` is used only for logging/stub dispatch.
    """
    model = model or LLM_MODEL
    try:
        if LLM_PROVIDER == "stub":
            from app.llm import stub

            result = stub.chat(messages, task=task)
        elif LLM_PROVIDER == "external":
            result = await _chat_external(messages, model, max_tokens)
        else:  # ollama / OpenAI-compatible
            result = await _chat_completions(messages, model, max_tokens, json_mode)
    except Exception as exc:
        logger.error(
            "llm.request_failed",
            extra={"provider": LLM_PROVIDER, "model": model, "task": task, "error": str(exc)},
        )
        raise

    logger.info(
        "llm.request",
        extra={
            "provider": LLM_PROVIDER,
            "model": model,
            "task": task,
            "input_tokens": result.get("input_tokens", 0),
            "output_tokens": result.get("output_tokens", 0),
        },
    )
    return result
