"""Backend question catalogue for the single-page assessment flow.

Derived from context/prompts/ai-questionnaire.json (~100 questions in 7 categories).
Replaces the old static catalogue that mirrored the frontend questionnaire.ts placeholder.
"""

from __future__ import annotations

import json
import pathlib

_HERE = pathlib.Path(__file__).resolve().parent


def _find_questionnaire() -> pathlib.Path:
    candidate = _HERE
    for _ in range(8):
        p = candidate / "context" / "prompts" / "ai-questionnaire.json"
        if p.exists():
            return p
        candidate = candidate.parent
    fallback = pathlib.Path("/app/context/prompts/ai-questionnaire.json")
    if fallback.exists():
        return fallback
    raise FileNotFoundError("ai-questionnaire.json not found")


def _load():
    path = _find_questionnaire()
    data = json.loads(path.read_text(encoding="utf-8"))
    questions = data.get("questions") or []

    sections_dict: dict[str, list[str]] = {}
    options: dict[str, list[str]] = {}
    labels: dict[str, str] = {}
    types: dict[str, str] = {}

    for q in questions:
        qid = q.get("id")
        if not qid:
            continue
        category = q.get("category", "Other")
        sections_dict.setdefault(category, []).append(qid)
        labels[qid] = q.get("question", qid)
        qtype = q.get("type", "DESCRIPTIVE")
        types[qid] = qtype
        allowed = q.get("allowedAnswers") or []
        if qtype == "PREDEFINED":
            options[qid] = [a if isinstance(a, str) else str(a) for a in allowed]
        elif qtype == "MULTISELECT":
            options[qid] = [
                a["value"] if isinstance(a, dict) else str(a) for a in allowed
            ]
        # DESCRIPTIVE → no options

    sections = [(cat, cat, ids) for cat, ids in sections_dict.items()]
    all_keys = [q for _, _, ids in sections for q in ids]
    return sections, all_keys, options, labels, types


# Ordered sections: list of (section_key, section_label, [question_ids])
SECTIONS: list[tuple[str, str, list[str]]]
# Flat ordered list of all question keys
ASSESSMENT_QUESTION_KEYS: list[str]
# Allowed option strings per question (PREDEFINED and MULTISELECT only)
QUESTION_OPTIONS: dict[str, list[str]]
# Human-readable label per question key
_QUESTION_LABEL: dict[str, str]
# Question type (PREDEFINED | MULTISELECT | DESCRIPTIVE) per question key
QUESTION_TYPES: dict[str, str]

(
    SECTIONS,
    ASSESSMENT_QUESTION_KEYS,
    QUESTION_OPTIONS,
    _QUESTION_LABEL,
    QUESTION_TYPES,
) = _load()


def question_catalogue() -> list[tuple[str, str, list[str]]]:
    """(question_key, label, options) in display order — for the prefill prompt."""
    from app.questionnaire_required import QUESTION_LABEL

    return [
        (q, QUESTION_LABEL.get(q, q), QUESTION_OPTIONS.get(q, []))
        for q in ASSESSMENT_QUESTION_KEYS
    ]


def section_of(question_key: str) -> str:
    """Return the category name for a question key."""
    for sec_key, _sec_label, keys in SECTIONS:
        if question_key in keys:
            return sec_key
    return "Scope"
