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

# All question keys that exist in the frontend questionnaire. Used to validate
# per-question assignment requests at the API boundary.
VALID_QUESTION_KEYS: frozenset[str] = frozenset({
    "affected_people",
    "automation_and_oversight",
    "biometric_categorisation_sensitive",
    "data_and_inputs",
    "decision_domain",
    "department",
    "emotion_recognition_workplace",
    "exception_category",
    "exploits_vulnerability",
    "external_id",
    "generates_synthetic_content",
    "is_biometric_identification",
    "is_chatbot",
    "is_credit_scoring",
    "is_critical_infrastructure",
    "is_education_related",
    "is_employment_related",
    "is_gpai",
    "is_judicial_admin",
    "is_law_enforcement",
    "is_migration",
    "is_public_service",
    "model_nature",
    "planned_modifications",
    "predictive_policing",
    "prohibited_practices",
    "real_time_biometric_public",
    "sector_legislation",
    "social_scoring_public",
    "subliminal_manipulation",
    "submission_type",
    "technologies",
    "training_compute_flops",
    "untargeted_facial_scraping",
    "use_case",
    "use_case_owner",
    "use_case_status",
    "use_case_type",
    "used_in_eu",
    "user_interaction",
})

# Human-readable label for each question key, for user-facing text (e.g. assignment
# emails). Mirrors the {key, label} entries in questionnaire.ts — keep in sync. Callers
# fall back to the raw key via .get(key, key), so a missing entry degrades gracefully.
QUESTION_LABEL: dict[str, str] = {
    "submission_type": "Type of Submission",
    "external_id": "External System ID",
    "use_case_owner": "Use Case Owner",
    "use_case_type": "Type of Use Case",
    "department": "Developing Business Unit",
    "technologies": "Technologies Involved",
    "use_case_status": "Status of AI Use Case",
    "use_case": "Detailed Description",
    "planned_modifications": "Planned Changes (12–24 months)",
    "used_in_eu": "Used in the European Union",
    "exception_category": "Exception Category",
    "sector_legislation": "Sector-Specific Legislation",
    "subliminal_manipulation": "Manipulative or Deceptive Techniques",
    "exploits_vulnerability": "Exploits Vulnerabilities",
    "social_scoring_public": "Social Scoring by Public Authority",
    "real_time_biometric_public": "Real-time Biometric ID in Public Spaces",
    "emotion_recognition_workplace": "Emotion Recognition (Workplace / Education)",
    "untargeted_facial_scraping": "Untargeted Facial Image Scraping",
    "predictive_policing": "Predictive Policing",
    "biometric_categorisation_sensitive": "Biometric Categorisation by Sensitive Attributes",
    "is_biometric_identification": "Identity & Biometric Analysis",
    "is_critical_infrastructure": "Infrastructure Management",
    "is_education_related": "Education & Training",
    "is_employment_related": "Human Resources (HR)",
    "is_credit_scoring": "Financial & Healthcare Services",
    "is_public_service": "Essential Public Services",
    "is_law_enforcement": "Public Safety & Policing",
    "is_migration": "Immigration & Border Control",
    "is_judicial_admin": "Legal & Democratic Governance",
    "is_gpai": "General-Purpose AI (GPAI)",
    "training_compute_flops": "Training Compute (FLOPs)",
    "is_chatbot": "Conversational AI / Chatbot",
    "generates_synthetic_content": "Generates Synthetic Content",
    "data_and_inputs": "Data & Inputs",
    "decision_domain": "Domain of Use",
    "automation_and_oversight": "Autonomy & Human Oversight",
    "affected_people": "Impact on People",
    "model_nature": "Model Nature",
    "user_interaction": "User Interaction & Content",
    "prohibited_practices": "Prohibited Practices Check",
}


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
