"""LLM client — resolves a per-request provider (bring-your-own-LLM or the
platform-default Thalamus) behind a uniform return shape.

Both backends are OpenAI-compatible ``/v1/chat/completions``, so the client is a
thin wrapper over the async ``openai`` SDK.

Provider precedence (issue #406), resolved **per request**:

  1. **Active BYO row** — an ``llm_provider_config`` row with ``is_active`` for the
     current Postgres schema (= current tenant in ``jwt`` mode). Overrides the
     platform default. Re-validated for SSRF at request time (defense in depth).
  2. **Platform-default Thalamus** — ``THALAMUS_BASE_URL`` / ``THALAMUS_BEARER_TOKEN``
     / ``THALAMUS_MODEL`` env. Used when no BYO row is active.
  3. **Stub** — deterministic offline responses, selected when the *resolved*
     base URL is unset or ``"stub"`` (default everywhere for dev/CI; no network).

There is **no silent fallback** between an active BYO provider and Thalamus on
error — a failing active provider raises, surfacing upstream as a 502.

Clients are cached per ``(base_url, token)`` so BYO and Thalamus (and multiple
tenants' BYO endpoints) each reuse their own connection pool.

Returns: ``{text, input_tokens, output_tokens, finish_reason}``.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.llm_config import resolve_llm_config, validate_endpoint_url

logger = get_logger(__name__)

THALAMUS_BASE_URL = os.environ.get("THALAMUS_BASE_URL", "")
THALAMUS_BEARER_TOKEN = os.environ.get("THALAMUS_BEARER_TOKEN", "")
THALAMUS_MODEL = os.environ.get("THALAMUS_MODEL", "Qwen/Qwen3.8-27B")
THALAMUS_VISION_MODEL = os.environ.get("THALAMUS_VISION_MODEL", THALAMUS_MODEL)


def _is_stub(base_url: str) -> bool:
    return base_url.strip().lower() in ("", "stub")


# Fail fast on misconfiguration of the platform default: a real gateway URL
# requires a bearer token — otherwise the first request dies deep inside httpx
# with an opaque 401. (BYO rows are validated separately at save/test time.)
if not _is_stub(THALAMUS_BASE_URL) and not THALAMUS_BEARER_TOKEN:
    raise RuntimeError(
        "THALAMUS_BASE_URL is set to a real gateway but THALAMUS_BEARER_TOKEN is empty. "
        "Set the bearer token in .env, or set THALAMUS_BASE_URL=stub for offline/CI mode."
    )


@dataclass(frozen=True)
class RuntimeConfig:
    """The provider actually used for a call: endpoint, token, model, and which
    source it came from (``"byo"`` or ``"thalamus"``). ``stub`` is True when the
    resolved base URL selects offline stub mode."""

    base_url: str
    api_token: str
    model: str
    source: str

    @property
    def stub(self) -> bool:
        return _is_stub(self.base_url)


async def resolve_runtime_config() -> RuntimeConfig:
    """Resolve the provider for the current request/tenant context.

    Opens its own session; under ``jwt`` the tenant-scoping hook routes it to the
    requesting tenant's schema, so the correct BYO row is read with no extra
    plumbing. Falls back to the Thalamus env default when no BYO row is active.
    """
    async with SessionLocal() as session:
        byo = await resolve_llm_config(session)

    if byo is not None:
        # Defense in depth: a row could be written around the admin API. Re-check
        # the URL before we make a server-side request to it. validate_endpoint_url
        # does a blocking DNS lookup (socket.getaddrinfo), so run it off the event
        # loop to avoid stalling other requests on a slow resolver.
        reason = await asyncio.to_thread(validate_endpoint_url, byo.base_url)
        if reason:
            logger.error(
                "llm.byo_rejected",
                extra={"base_url": byo.base_url, "reason": reason},
            )
            raise RuntimeError(f"Configured LLM endpoint is not allowed: {reason}")
        return RuntimeConfig(
            base_url=byo.base_url,
            api_token=byo.api_token,
            model=byo.model,
            source="byo",
        )

    return RuntimeConfig(
        base_url=THALAMUS_BASE_URL,
        api_token=THALAMUS_BEARER_TOKEN,
        model=THALAMUS_MODEL,
        source="thalamus",
    )


# ---------------------------------------------------------------------------
# OpenAI-compatible backend (/v1/chat/completions)
# ---------------------------------------------------------------------------

# AsyncOpenAI clients cached per (base_url, token) — each keeps its own pool.
# Bounded so token rotation / many tenants can't grow it without limit; the LRU
# eviction drops the oldest client (its pool is closed on GC).
_clients: dict[tuple[str, str], Any] = {}
_CLIENTS_MAX = 32


def _get_client(base_url: str, api_token: str) -> Any:
    from openai import AsyncOpenAI

    key = (base_url, api_token)
    client = _clients.get(key)
    if client is None:
        if len(_clients) >= _CLIENTS_MAX:
            # Evict the oldest entry (dicts preserve insertion order).
            oldest = next(iter(_clients))
            del _clients[oldest]
        client = AsyncOpenAI(base_url=base_url, api_key=api_token or "none")
        _clients[key] = client
    return client


async def _chat_completions(
    cfg: RuntimeConfig,
    messages: list[dict],
    model: str,
    max_tokens: int,
    json_mode: bool,
) -> dict:
    client = _get_client(cfg.base_url, cfg.api_token)
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    }
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
# Public interface
# ---------------------------------------------------------------------------


async def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    max_tokens: int = 1024,
    json_mode: bool = False,
    task: str = "chat",
    config: RuntimeConfig | None = None,
) -> dict:
    """Call the resolved provider; return {text, input_tokens, output_tokens, finish_reason}.

    ``config`` lets a long-running caller (the prefill pipeline) resolve the
    provider **once** at run start and pin it across every batch, so a mid-run
    admin config change can't split one assessment across two providers. One-off
    callers (assist turns, classify) omit it and ``chat()`` resolves per call.

    ``model`` defaults to the resolved provider's model; callers pass an explicit
    model (e.g. a vision model) to override. ``task`` is used only for logging /
    stub dispatch.
    """
    cfg = config or await resolve_runtime_config()
    # An explicit model from the caller wins (vision override); otherwise use the
    # resolved provider's model.
    call_model = model or cfg.model
    try:
        if cfg.stub:
            from app.llm import stub

            result = stub.chat(messages, task=task)
        else:
            result = await _chat_completions(
                cfg, messages, call_model, max_tokens, json_mode
            )
    except Exception as exc:
        logger.error(
            "llm.request_failed",
            extra={
                "model": call_model,
                "task": task,
                "provider": cfg.source,
                "error": str(exc),
            },
        )
        raise

    finish_reason = result.get("finish_reason", "stop")
    log = logger.warning if finish_reason == "length" else logger.info
    log(
        "llm.request",
        extra={
            "model": call_model,
            "task": task,
            "provider": cfg.source,
            "input_tokens": result.get("input_tokens", 0),
            "output_tokens": result.get("output_tokens", 0),
            "finish_reason": finish_reason,
        },
    )
    return result
