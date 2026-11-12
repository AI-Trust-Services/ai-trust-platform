"""JSON parsing for LLM responses, with auto-repair and structural validation retries.

The model is asked for a single JSON object per turn, but small models drift:
they wrap output in code fences, add prose, or emit trailing text. We strip the
obvious cases; if that fails, we retry up to max_attempts total with a repair
prompt. Structural validation failures (wrong schema shape) also trigger retries.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from ai_trust_logging import get_logger

from app.llm.client import chat
from app.llm.templates import render_template

logger = get_logger(__name__)

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


class LLMParseError(Exception):
    """Raised when an LLM response cannot be parsed as JSON, even after repair."""


def _extract_json(text: str) -> dict:
    """Best-effort: strip code fences, then parse; else grab the first {...} block."""
    candidate = text.strip()
    fenced = _FENCE_RE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    # Fall back to the first balanced-looking {...} span.
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end > start:
        return json.loads(candidate[start : end + 1])
    raise json.JSONDecodeError("no JSON object found", candidate, 0)


async def parse_json_response(
    text: str, *, task: str = "parse", max_tokens: int = 1024
) -> dict[str, Any]:
    """Parse ``text`` as a JSON object, with one LLM repair retry on failure.

    ``max_tokens`` controls the repair call token limit — callers with large
    outputs (e.g. the questionnaire pipeline) should pass their own limit so
    the repair call has enough room to reproduce the full response.
    """
    try:
        return _extract_json(text)
    except (json.JSONDecodeError, ValueError):
        logger.warning("llm.parse_retry", extra={"task": task})

    # One repair attempt: hand the malformed text back and ask for pure JSON.
    repair_messages = [
        {
            "role": "system",
            "content": render_template("json_repair_system"),
        },
        {
            "role": "user",
            "content": render_template("json_repair_user", malformed_response=text),
        },
    ]
    repaired: dict | None = None
    try:
        repaired = await chat(
            repair_messages,
            json_mode=True,
            task=f"{task}_repair",
            max_tokens=max_tokens,
        )
        return _extract_json(repaired["text"])
    except Exception as exc:
        logger.error(
            "llm.parse_failed",
            extra={
                "task": task,
                "error": str(exc),
                "repaired_snippet": repaired["text"][:200]
                if repaired
                else "(no response)",
            },
        )
        raise LLMParseError(f"Could not parse LLM response for task '{task}'") from exc


async def parse_with_retry(
    text: str,
    task: str,
    validator: Callable[[dict], dict],
    chat_fn: Callable,
    messages: list[dict],
    max_attempts: int = 3,
) -> dict[str, Any]:
    """Parse + structurally validate with up to ``max_attempts`` total LLM calls.

    Attempt 1: parse ``text`` then run ``validator``.
    Attempt 2+: re-call ``chat_fn`` with a repair prompt, parse the new response,
                then validate again. The repair prompt on attempt 3 also includes
                the previous validator error so the model knows what to fix.

    Raises ``LLMParseError`` after ``max_attempts`` exhausted.

    Args:
        text: The initial LLM response text.
        task: Task label for logging.
        validator: Callable that takes a parsed dict and returns it unchanged,
                   or raises ``LLMParseError`` on structural violations.
        chat_fn: Async callable matching ``chat(messages, task, json_mode)`` signature.
        messages: The original messages list used to produce ``text``; the repair
                  prompt is appended to this conversation and a new call is made.
        max_attempts: Total number of LLM calls allowed (default 3).
    """
    last_error: Exception | None = None
    current_text = text

    for attempt in range(1, max_attempts + 1):
        if attempt > 1:
            # Re-call the LLM with repair prompt.
            repair_hint = ""
            if last_error is not None:
                repair_hint = f"\n\nSpecific issue to fix: {last_error}"
            repair_messages = [
                {
                    "role": "system",
                    "content": render_template("json_repair_system"),
                },
                {
                    "role": "user",
                    "content": render_template(
                        "json_repair_user",
                        malformed_response=current_text + repair_hint,
                    ),
                },
            ]
            logger.warning(
                "llm.parse_with_retry.attempt",
                extra={"task": task, "attempt": attempt, "error": str(last_error)},
            )
            try:
                response = await chat_fn(
                    repair_messages, task=f"{task}_repair_{attempt}", json_mode=True
                )
                current_text = response["text"]
            except Exception as exc:
                last_error = exc
                continue

        try:
            parsed = _extract_json(current_text)
        except (json.JSONDecodeError, ValueError) as exc:
            last_error = LLMParseError(f"JSON parse failed: {exc}")
            continue

        try:
            return validator(parsed)
        except LLMParseError as exc:
            last_error = exc
            continue

    logger.error(
        "llm.parse_with_retry.exhausted",
        extra={
            "task": task,
            "max_attempts": max_attempts,
            "last_error": str(last_error),
        },
    )
    raise LLMParseError(
        f"Could not produce a valid response for task '{task}' after {max_attempts} attempts. "
        f"Last error: {last_error}"
    )
