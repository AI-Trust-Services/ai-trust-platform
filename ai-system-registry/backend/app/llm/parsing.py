"""JSON parsing for LLM responses, with auto-repair and structural validation retries.

The model is asked for a single JSON object per turn, but small models drift:
they wrap output in code fences, add prose, or emit trailing text. We strip the
obvious cases; if that fails, we retry up to max_attempts total. Two kinds of
failure get two different retry prompts:

* **Syntax** (not a JSON object) — hand the malformed text back and ask for pure
  JSON (``json_repair_*`` templates).
* **Contract** (valid JSON, wrong content: missing question, option not allowed…)
  — re-ask with the *original* conversation plus the model's previous answer and
  the list of violations (``json_validation_retry`` template), so the model can
  re-read the evidence instead of "repairing" blind.
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
    """Best-effort: strip code fences, then parse; else grab the first {...} block.

    Always returns a ``dict``. A top-level array/string/number is a contract
    violation, not a result — returning it would crash validators with an
    ``AttributeError`` that no retry loop catches.
    """
    candidate = text.strip()
    fenced = _FENCE_RE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()

    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        # Fall back to the first balanced-looking {...} span.
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end <= start:
            raise json.JSONDecodeError("no JSON object found", candidate, 0)
        value = json.loads(candidate[start : end + 1])

    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object, got {type(value).__name__}")
    return value


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


def _retry_messages(
    *,
    syntax_failure: bool,
    original_messages: list[dict],
    previous_text: str,
    error: Exception | None,
) -> list[dict]:
    """Build the messages for a retry attempt (see module docstring)."""
    if syntax_failure:
        return [
            {"role": "system", "content": render_template("json_repair_system")},
            {
                "role": "user",
                "content": render_template(
                    "json_repair_user", malformed_response=previous_text
                ),
            },
        ]
    return [
        *original_messages,
        {"role": "assistant", "content": previous_text},
        {
            "role": "user",
            "content": render_template(
                "json_validation_retry", violations=str(error or "unknown")
            ),
        },
    ]


async def parse_with_retry(
    text: str,
    task: str,
    validator: Callable[[dict], dict],
    chat_fn: Callable,
    messages: list[dict],
    max_attempts: int = 3,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Parse + structurally validate with up to ``max_attempts`` total LLM calls.

    Attempt 1: parse ``text`` then run ``validator``.
    Attempt 2+: re-call ``chat_fn`` with a retry prompt (syntax failure → JSON
                repair prompt; contract failure → original ``messages`` + the
                previous answer + the violations), parse, then validate again.

    Raises ``LLMParseError`` after ``max_attempts`` exhausted.

    Args:
        text: The initial LLM response text.
        task: Task label for logging.
        validator: Callable that takes a parsed dict and returns it unchanged,
                   or raises ``LLMParseError`` on contract violations. It should
                   report *all* violations in one error so one retry can fix them.
        chat_fn: Async callable matching ``chat(messages, task, json_mode, max_tokens)``.
        messages: The original messages that produced ``text`` — used as the
                  context for contract-failure retries.
        max_attempts: Total number of LLM calls allowed (default 3).
        max_tokens: Output-token cap forwarded to retry calls. Pass the cap used
                    for the original call: a retry reproduces the full response,
                    and the ``chat`` default would silently truncate large ones.
    """
    last_error: Exception | None = None
    syntax_failure = False
    current_text = text

    for attempt in range(1, max_attempts + 1):
        if attempt > 1:
            logger.warning(
                "llm.parse_with_retry.attempt",
                extra={"task": task, "attempt": attempt, "error": str(last_error)},
            )
            kwargs: dict[str, Any] = {"json_mode": True}
            if max_tokens is not None:
                kwargs["max_tokens"] = max_tokens
            try:
                response = await chat_fn(
                    _retry_messages(
                        syntax_failure=syntax_failure,
                        original_messages=messages,
                        previous_text=current_text,
                        error=last_error,
                    ),
                    task=f"{task}_repair_{attempt}",
                    **kwargs,
                )
            except Exception as exc:
                last_error = exc
                continue
            if response.get("finish_reason") == "length":
                # A truncated retry is unusable; keep the previous text/context and
                # try again rather than parsing a cut-off object.
                last_error = LLMParseError(
                    "retry output truncated (finish_reason=length)"
                )
                continue
            current_text = response["text"]

        try:
            parsed = _extract_json(current_text)
        except (json.JSONDecodeError, ValueError) as exc:
            last_error = LLMParseError(f"JSON parse failed: {exc}")
            syntax_failure = True
            continue

        try:
            return validator(parsed)
        except LLMParseError as exc:
            last_error = exc
            syntax_failure = False
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
