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


# Allowed option strings for the constrained (select / boolean) questions,
# mirroring BUSINESS_QUESTIONS in
# ai-system-registry/frontend/src/config/questionnaire.ts. Keep in sync — same
# contract as QUESTION_LABEL ↔ questionnaire.ts (see module docstring). Only
# select/boolean keys appear here; free-text questions are omitted (no options).
# The prefill prompt uses these to force the model to answer a choice question
# with one of these exact strings, so the frontend radios (exact-match) select.
QUESTION_OPTIONS: dict[str, list[str]] = {
    "submission_type": [
        "Initial Submission (first time registering this AI system)",
        "Update / Correction Submission (resubmission after feedback or system changes)",
    ],
    "use_case_type": [
        "Standard development planned for general availability",
        "Customer-specific development",
        "Internal development for own organisational use",
        "Third-party system or product planned for integration",
        "Third-party system or product for internal use",
        "Partner-developed system",
        "Professional services — multi-customer solution",
    ],
    "use_case_status": [
        "New AI use case",
        "Existing AI use case",
        "Other",
    ],
    "exception_category": [
        "AI systems developed and used exclusively for military purposes (Art. 2(3))",
        "AI systems used by public authorities in third countries for law enforcement (Art. 2(4))",
        "AI research and development activity (Art. 2(6))",
        "People using AI systems for purely personal, non-professional activity (Art. 2(10))",
        "AI components provided under free and open-source licences (Art. 2(12)) — only for non-GPAI models",
        "None of the above",
    ],
    "sector_legislation": [
        "Yes — covered by sector-specific legislation",
        "Yes — covered by Union Harmonisation Regulation",
        "None of the above",
    ],
    # Boolean, rendered as Yes/No radios in QuestionView.
    "used_in_eu": ["Yes", "No"],
}


def question_catalogue() -> list[tuple[str, str, list[str]]]:
    """(question_key, label, options) in display order — fed to the prefill
    prompt. ``options`` is ``[]`` for free-text questions."""
    return [
        (q, QUESTION_LABEL.get(q, q), QUESTION_OPTIONS.get(q, []))
        for q in ASSESSMENT_QUESTION_KEYS
    ]


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
