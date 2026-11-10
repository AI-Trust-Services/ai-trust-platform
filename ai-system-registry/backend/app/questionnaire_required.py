"""Server-side question keys for the EU AI Act questionnaire.

Keys and labels are derived from context/prompts/ai-questionnaire.json,
loaded at module level via app.llm.templates.load_questionnaire.
"""

from __future__ import annotations

import json

from app.questionnaire_loader import find_questionnaire


def _load() -> tuple[frozenset[str], dict[str, str]]:
    path = find_questionnaire()
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
