"""JSON parsing for LLM responses, with a single auto-repair retry (design Q12).

The model is asked for a single JSON object per turn, but small models drift:
they wrap output in code fences, add prose, or emit trailing text. We strip the
obvious cases; if that fails, we make ONE repair call asking the model to return
only valid JSON, then give up with a typed LLMParseError.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ai_trust_logging import get_logger

from app.llm.client import chat

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


async def parse_json_response(text: str, *, task: str = "parse") -> dict[str, Any]:
    """Parse ``text`` as a JSON object, with one LLM repair retry on failure."""
    try:
        return _extract_json(text)
    except (json.JSONDecodeError, ValueError):
        logger.warning("llm.parse_retry", extra={"task": task})

    # One repair attempt: hand the malformed text back and ask for pure JSON.
    repair_messages = [
        {
            "role": "system",
            "content": "You return only a single valid JSON object. No prose, no code fences.",
        },
        {
            "role": "user",
            "content": f"Convert the following into a single valid JSON object and return ONLY that object:\n\n{text}",
        },
    ]
    try:
        repaired = await chat(repair_messages, json_mode=True, task=f"{task}_repair", max_tokens=1024)
        return _extract_json(repaired["text"])
    except Exception as exc:
        logger.error("llm.parse_failed", extra={"task": task, "error": str(exc)})
        raise LLMParseError(f"Could not parse LLM response for task '{task}'") from exc
