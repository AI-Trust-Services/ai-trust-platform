"""Backend question catalogue for the single-page assessment flow.

The authoritative question set still lives in the two ``questionnaire.ts`` files
(frontend); this module mirrors the subset the backend needs to drive the
single-page assessment server-side: an ordered list of questions grouped into
sections (for the left sidebar + prefill catalogue) and the mapping from a fired
classifier flag back to the question that most directly drove it (for the
"Why this classification" decisive-answers panel, #346).

Keep the keys/labels in sync with ``questionnaire_required.py::QUESTION_LABEL``.
"""

from __future__ import annotations

from app.classifier import _ANNEX_III_AREAS, _PROHIBITED_FLAGS
from app.questionnaire_required import (
    QUESTION_LABEL,
    REQUIRED_AI_TECHNICAL,
)

# Ordered sections → question keys, mirroring the two questionnaire sections.
# "business" = the Use Case & Context questions the owner answers; "technical" =
# the AI-mode free-text risk questions the LLM infers flags from.
SECTIONS: list[tuple[str, str, list[str]]] = [
    (
        "business",
        "Use Case & Context",
        [
            "submission_type",
            "use_case_owner",
            "use_case_type",
            "department",
            "technologies",
            "use_case_status",
            "use_case",
            "planned_modifications",
            "used_in_eu",
            "exception_category",
            "sector_legislation",
        ],
    ),
    (
        "technical",
        "AI Risk Classification",
        list(REQUIRED_AI_TECHNICAL),
    ),
]

# Flat ordered (section_key, section_label, question_key) tuples.
ORDERED_QUESTIONS: list[tuple[str, str, str]] = [
    (sec_key, sec_label, q_key)
    for sec_key, sec_label, keys in SECTIONS
    for q_key in keys
]

# All question keys the single-page flow renders, in order.
ASSESSMENT_QUESTION_KEYS: list[str] = [q for _, _, q in ORDERED_QUESTIONS]


def question_catalogue() -> list[tuple[str, str]]:
    """(question_key, label) pairs in display order — fed to the prefill prompt."""
    return [(q, QUESTION_LABEL.get(q, q)) for q in ASSESSMENT_QUESTION_KEYS]


def section_of(question_key: str) -> str:
    for sec_key, _sec_label, keys in SECTIONS:
        if question_key in keys:
            return sec_key
    return "business"


# ── Decisive-question mapping ────────────────────────────────────────────────
# In AI mode each classifier flag is inferred from the free-text technical
# questions, so a fired flag maps to the technical question whose answer most
# directly evidences it. This is a pragmatic iteration-1 mapping; a fired flag
# with no specific mapping falls back to the general "prohibited_practices" /
# "decision_domain" catch-alls.

_FLAG_TO_QUESTION: dict[str, str] = {
    # Annex III areas → the domain-of-use question.
    **{attr: "decision_domain" for attr in _ANNEX_III_AREAS},
    # Art. 5 prohibited flags → the prohibited-practices question.
    **{attr: "prohibited_practices" for attr, _ in _PROHIBITED_FLAGS},
    # GPAI / transparency drivers.
    "is_gpai": "model_nature",
    "training_compute_flops": "model_nature",
    "is_chatbot": "user_interaction",
    "generates_synthetic_content": "user_interaction",
}

# Human-readable label per flag (for the decisive-answer row), from the
# classifier's own Art.5 / Annex III label tables.
_FLAG_LABEL: dict[str, str] = {
    **{attr: label for attr, label in _PROHIBITED_FLAGS},
    **{attr: label for attr, (_num, label) in _ANNEX_III_AREAS.items()},
    "is_gpai": "General-purpose AI model",
    "training_compute_flops": "Training compute (systemic-risk threshold)",
    "is_chatbot": "Conversational AI / chatbot (Art. 50 transparency)",
    "generates_synthetic_content": "Generates synthetic content (Art. 50 transparency)",
}


def decisive_question_keys(fired_flags: list[str]) -> list[str]:
    """Map the flags that drove the tier → the question keys to surface, de-duped
    and in display order."""
    mapped = {_FLAG_TO_QUESTION[f] for f in fired_flags if f in _FLAG_TO_QUESTION}
    return [q for q in ASSESSMENT_QUESTION_KEYS if q in mapped]


def flag_label(flag: str) -> str:
    return _FLAG_LABEL.get(flag, flag)
