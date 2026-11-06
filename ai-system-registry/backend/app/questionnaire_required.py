"""Server-side question keys for the EU AI Act questionnaire.

Keys and labels are derived from context/prompts/ai-questionnaire.json,
loaded at module level via app.llm.templates.load_questionnaire.
"""

from __future__ import annotations

import json
import pathlib

# Locate the questionnaire JSON relative to this file.  Works both in Docker
# (/app/context/prompts/…) and in local dev (up through the repo root).
_HERE = pathlib.Path(__file__).resolve().parent


def _find_questionnaire() -> pathlib.Path:
    candidate = _HERE
    for _ in range(8):
        p = candidate / "context" / "prompts" / "ai-questionnaire.json"
        if p.exists():
            return p
        candidate = candidate.parent
    # Fallback: try absolute Docker path
    fallback = pathlib.Path("/app/context/prompts/ai-questionnaire.json")
    if fallback.exists():
        return fallback
    raise FileNotFoundError("ai-questionnaire.json not found")


def _load() -> tuple[frozenset[str], dict[str, str]]:
    path = _find_questionnaire()
    data = json.loads(path.read_text(encoding="utf-8"))
    questions = data.get("questions") or []
    keys: set[str] = set()
    labels: dict[str, str] = {}
    for q in questions:
        qid = q.get("id")
        if qid:
            keys.add(qid)
            labels[qid] = q.get("question", qid)
    return frozenset(keys), labels


VALID_QUESTION_KEYS: frozenset[str]
QUESTION_LABEL: dict[str, str]

VALID_QUESTION_KEYS, QUESTION_LABEL = _load()
