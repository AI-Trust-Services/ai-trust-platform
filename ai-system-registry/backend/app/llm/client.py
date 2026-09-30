"""LLM client — Thalamus inference backend with a uniform return shape.

Thalamus exposes an OpenAI-compatible /v1/chat/completions endpoint.
Model switching is configuration-only: set THALAMUS_MODEL / THALAMUS_VISION_MODEL
to the exact metadata.name of the deployed Thalamus Model CR.

Stub mode: set THALAMUS_BASE_URL=stub (or leave it unset) for deterministic
offline responses. This must be set explicitly — there is no silent fallback.

All providers return: ``{text, input_tokens, output_tokens, finish_reason}``.
"""

from __future__ import annotations

import os
from typing import Any

from ai_trust_logging import get_logger

logger = get_logger(__name__)

THALAMUS_BASE_URL = os.environ.get("THALAMUS_BASE_URL", "")
THALAMUS_BEARER_TOKEN = os.environ.get("THALAMUS_BEARER_TOKEN", "")
THALAMUS_MODEL = os.environ.get("THALAMUS_MODEL", "smollm2-135m")
THALAMUS_VISION_MODEL = os.environ.get("THALAMUS_VISION_MODEL", THALAMUS_MODEL)

_thalamus_client: Any = None  # AsyncOpenAI singleton — reuses the connection pool


async def _chat_completions(
    messages: list[dict], model: str, max_tokens: int, json_mode: bool
) -> dict:
    global _thalamus_client
    from openai import AsyncOpenAI

    if _thalamus_client is None:
        _thalamus_client = AsyncOpenAI(
            base_url=THALAMUS_BASE_URL,
            api_key=THALAMUS_BEARER_TOKEN or "none",
        )
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = await _thalamus_client.chat.completions.create(**kwargs)
    usage = response.usage
    return {
        "text": response.choices[0].message.content or "",
        "input_tokens": usage.prompt_tokens if usage else 0,
        "output_tokens": usage.completion_tokens if usage else 0,
        "finish_reason": response.choices[0].finish_reason or "stop",
    }


async def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    max_tokens: int = 1024,
    json_mode: bool = False,
    task: str = "chat",
) -> dict:
    """Call Thalamus and return {text, input_tokens, output_tokens, finish_reason}.

    ``model`` defaults to ``THALAMUS_MODEL``; callers pass ``THALAMUS_VISION_MODEL``
    for image tasks. ``task`` is used only for logging/stub dispatch.
    """
    model = model or THALAMUS_MODEL
    try:
        if not THALAMUS_BASE_URL or THALAMUS_BASE_URL == "stub":
            from app.llm import stub

            result = stub.chat(messages, task=task)
        else:
            result = await _chat_completions(messages, model, max_tokens, json_mode)
    except Exception as exc:
        logger.error(
            "llm.request_failed",
            extra={
                "model": model,
                "task": task,
                "error": str(exc),
            },
        )
        raise

    logger.info(
        "llm.request",
        extra={
            "model": model,
            "task": task,
            "input_tokens": result.get("input_tokens", 0),
            "output_tokens": result.get("output_tokens", 0),
        },
    )
    return result
