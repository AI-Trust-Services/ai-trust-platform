"""Server-side required-question lists for the registration questionnaire.

Keep in sync with ai-system-registry/frontend/src/config/questionnaire.ts
(BUSINESS_QUESTIONS / AI_TECHNICAL_QUESTIONS). NOTE: the ``BUSINESS_QUESTIONNAIRE_KEYS``
list in ``app.llm.prompts`` is a stale 8-key set used only by the stub chat — it is NOT
the real questionnaire and must not be reused here.

The compliance officer (the last person in the workflow, who holds liability) cannot
approve a system until every required business and technical question is answered. The
business and technical assignees may submit partial sections; only approval is gated.
"""
from __future__ import annotations

# (key, storage): "system" = top-level AISystem column, "answers" = questionnaire_answers[key].
# Optional keys (external_id, additional_entity_roles) and boolean/number keys (used_in_eu)
# are intentionally omitted — an unchecked box / blank optional field is a valid answer.
REQUIRED_BUSINESS: list[tuple[str, str]] = [
    ("submission_type", "answers"),
    ("use_case_owner", "answers"),
    ("use_case_type", "answers"),
    ("department", "system"),
    ("technologies", "answers"),
    ("use_case_status", "answers"),
    ("use_case", "system"),
    ("planned_modifications", "answers"),
    ("entity_role", "answers"),
    ("exception_category", "answers"),
    ("sector_legislation", "answers"),
]

# AI-mode technical free-text questions, stored under questionnaire_answers["technical"].
REQUIRED_AI_TECHNICAL: list[str] = [
    "data_and_inputs",
    "decision_domain",
    "automation_and_oversight",
    "affected_people",
    "model_nature",
    "user_interaction",
    "prohibited_practices",
]


def _empty(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def missing_business_keys(row) -> list[str]:
    """Business keys with no answer. A key counts as answered if EITHER its column
    OR its questionnaire_answers entry is non-empty (dual-storage robustness)."""
    answers = row.questionnaire_answers or {}
    missing = []
    for key, storage in REQUIRED_BUSINESS:
        column_value = getattr(row, key, None) if storage == "system" else None
        if _empty(column_value) and _empty(answers.get(key)):
            missing.append(key)
    return missing


def missing_technical_keys(row) -> list[str]:
    """AI-mode technical free-text keys with no answer. Manual-questionnaire mode uses
    boolean/number flag columns, which are always considered answered → no gaps."""
    if row.registration_mode != "ai":
        return []
    technical = (row.questionnaire_answers or {}).get("technical") or {}
    return [k for k in REQUIRED_AI_TECHNICAL if _empty(technical.get(k))]


def missing_for_approval(row) -> list[str]:
    """All required questions still unanswered at CO approval time. Empty for
    ``full_manual`` systems, which have no questionnaire sections."""
    if row.registration_mode == "full_manual":
        return []
    return missing_business_keys(row) + missing_technical_keys(row)
