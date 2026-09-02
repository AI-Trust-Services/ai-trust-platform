"""EU AI Act 4-tier classifier.

Waterfall: Art. 5 (prohibited) → GPAI → Annex III (high-risk) → Art. 50 (limited) → minimal
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from app.schemas import ClassificationResult

_GPAI_SYSTEMIC_FLOPS_THRESHOLD = 10**25  # EU AI Act Art. 51(1)(a)

_ANNEX_III_OBLIGATIONS = [
    "Art. 9 — Risk management system",
    "Art. 10 — Data governance",
    "Art. 11 — Technical documentation (Annex IV)",
    "Art. 12 — Record-keeping / logging",
    "Art. 13 — Transparency & instructions for use",
    "Art. 14 — Human oversight",
    "Art. 15 — Accuracy, robustness, cybersecurity",
    "Art. 49 — Registration in EU database",
]

_GPAI_STANDARD_OBLIGATIONS = [
    "Art. 53 — Technical documentation for GPAI models",
    "Art. 53 — Copyright summary",
    "Art. 53 — Training data summary",
]

_GPAI_SYSTEMIC_OBLIGATIONS = _GPAI_STANDARD_OBLIGATIONS + [
    "Art. 55 — Adversarial testing",
    "Art. 55 — Incident reporting to AI Office",
    "Art. 55 — Cybersecurity protection",
]

_LIMITED_OBLIGATIONS = [
    "Art. 50 — Transparency obligation (inform users they interact with AI)",
]

_ANNEX_III_AREAS = {
    "is_biometric_identification": (1, "Biometric identification & categorisation"),
    "is_critical_infrastructure": (2, "Critical infrastructure management"),
    "is_education_related": (3, "Education & vocational training"),
    "is_employment_related": (4, "Employment, workers management & access to self-employment"),
    "is_credit_scoring": (5, "Access to essential private services (credit scoring)"),
    "is_public_service": (5, "Access to essential public services"),
    "is_law_enforcement": (6, "Law enforcement"),
    "is_migration": (7, "Migration, asylum & border control management"),
    "is_judicial_admin": (8, "Administration of justice & democratic processes"),
}

# Art. 5 — prohibited practices. Module-level so CLASSIFIER_INPUTS can derive
# from it and stay in sync with classify().
_PROHIBITED_FLAGS = [
    ("subliminal_manipulation", "Art. 5(1)(a) subliminal manipulation"),
    ("exploits_vulnerability", "Art. 5(1)(b) exploits vulnerability"),
    ("social_scoring_public", "Art. 5(1)(c) social scoring by public authority"),
    ("real_time_biometric_public", "Art. 5(1)(d) real-time remote biometric ID in public"),
    ("emotion_recognition_workplace", "Art. 5(1)(f) emotion recognition in workplace/education"),
    ("untargeted_facial_scraping", "Art. 5(1)(e) untargeted facial image scraping"),
    ("predictive_policing", "Art. 5(1)(d) predictive policing"),
    ("biometric_categorisation_sensitive", "Art. 5(1)(g) biometric categorisation (sensitive)"),
]


# Single source of truth for the fields the classifier reads. Importers (e.g.
# systems.py) use this to decide when an update must trigger reclassification —
# keep it derived from the structures above so it can't drift out of sync.
CLASSIFIER_INPUTS = frozenset(
    {attr for attr, _ in _PROHIBITED_FLAGS}
    | set(_ANNEX_III_AREAS)
    | {"is_gpai", "training_compute_flops", "is_chatbot", "generates_synthetic_content"}
)



def classify(body: Any) -> ClassificationResult:
    # Art. 5 — prohibited practices
    triggered = [label for attr, label in _PROHIBITED_FLAGS if getattr(body, attr, False)]
    if triggered:
        return ClassificationResult(
            tier="prohibited",
            basis=f"Prohibited under EU AI Act Art. 5: {'; '.join(triggered)}",
            obligations=["Art. 5 — System must not be placed on market or put into service"],
        )

    # GPAI
    if body.is_gpai:
        systemic = body.training_compute_flops >= _GPAI_SYSTEMIC_FLOPS_THRESHOLD
        tier = "gpai-systemic" if systemic else "gpai-standard"
        obligations = _GPAI_SYSTEMIC_OBLIGATIONS if systemic else _GPAI_STANDARD_OBLIGATIONS
        basis = (
            f"General-purpose AI model — {'systemic risk (Art. 51, ≥10²⁵ FLOPs)' if systemic else 'standard (Art. 53)'}"
        )
        return ClassificationResult(tier=tier, basis=basis, obligations=obligations)

    # Annex III — high-risk
    for attr, (area_num, area_label) in _ANNEX_III_AREAS.items():
        if getattr(body, attr, False):
            return ClassificationResult(
                tier="high",
                basis=f"High-risk under EU AI Act Annex III, Area {area_num}: {area_label}",
                obligations=_ANNEX_III_OBLIGATIONS,
                annex_iii_area=area_num,
            )

    # Art. 50 — limited risk
    if body.is_chatbot or body.generates_synthetic_content:
        return ClassificationResult(
            tier="limited",
            basis="Limited-risk under EU AI Act Art. 50 (transparency obligations)",
            obligations=_LIMITED_OBLIGATIONS,
        )

    # Minimal risk
    return ClassificationResult(
        tier="minimal",
        basis="Minimal risk — no mandatory obligations under EU AI Act",
        obligations=[],
    )


def _classify_from_flags(flags: list[Any]) -> ClassificationResult:
    """Run the deterministic classifier over a list of inferred flags.

    Each item needs ``.flag`` (name) and ``.value`` attributes. Builds a synthetic
    namespace with every classifier input defaulted false / 0.0, applies the flags,
    then calls ``classify()``. Shared by the AI-assisted intake turn and the
    questionnaire workflow so both take the exact same path into ``classify()``.
    """
    obj = SimpleNamespace(**{name: False for name in CLASSIFIER_INPUTS})
    obj.training_compute_flops = 0.0
    for f in flags:
        if f.flag in CLASSIFIER_INPUTS:
            setattr(obj, f.flag, f.value)
    return classify(obj)


async def classify_ai_questionnaire(row: Any) -> tuple[ClassificationResult, dict]:
    """AI-mode classification from a system's stored questionnaire answers.

    Infers the hidden classifier flags from the free-text business + technical
    answers via the LLM, runs the deterministic ``classify()`` over them, and
    returns ``(ClassificationResult, extended_rationale)`` where the rationale is
    the ``ClassificationRationale`` shape ``{flags, confidence, reasoning,
    missing_info}`` — visible only to the compliance officer.

    Called identically by submit-technical and submit-info. The LLM call happens
    *before* any status mutation in the router, so an ``LLMParseError`` leaves the
    row untouched and the router can return 502 without corrupting workflow state.

    Imports from ``app.llm`` are deferred to avoid a circular import
    (``app.llm.prompts`` imports ``CLASSIFIER_INPUTS`` from this module at import time).
    """
    from app.llm import (
        build_classify_questionnaire_messages,
        chat,
        parse_json_response,
    )
    from app.schemas import InferredFlag

    answers = dict(row.questionnaire_answers or {})
    technical_answers = answers.pop("technical", {}) or {}
    business_answers = {
        "intended_purpose": row.intended_purpose or "",
        "department": row.department or "",
        "use_case": row.use_case or "",
        "people_affected": row.people_affected or "",
        "decision_context": row.decision_context or "",
        **answers,
    }

    messages = build_classify_questionnaire_messages(business_answers, technical_answers)
    result = await chat(messages, json_mode=True, task="classify_questionnaire")
    parsed = await parse_json_response(result["text"], task="classify_questionnaire")

    inferred = [InferredFlag(**f) for f in parsed.get("inferred_flags", [])]
    classification = _classify_from_flags(inferred)

    confidence = parsed.get("confidence")
    rationale = {
        "flags": [f.model_dump() for f in inferred],
        "confidence": float(confidence) if isinstance(confidence, (int, float)) else None,
        "reasoning": parsed.get("reasoning"),
        "missing_info": parsed.get("missing_info") or [],
        "org_role": parsed.get("org_role"),
        "org_role_rationale": parsed.get("org_role_rationale"),
    }
    return classification, rationale
