"""Deterministic stub LLM provider (LLM_PROVIDER=stub, the default everywhere).

Canned responses keyed by task, with light keyword matching on the conversation,
so tests / local dev can drive the full agentic loop with no network. The turn
task walks a fixed "recruiting assistant" (TalentMatch) sequence that converges
to complete in exactly len(REQUIRED_FIELD_KEYS) user turns; infer-flags maps a
recruiting use-case onto is_employment_related=true. The questionnaire tasks walk
their own deterministic sequences.
"""
from __future__ import annotations

import json

from app.llm.prompts import REQUIRED_FIELD_KEYS, BUSINESS_QUESTIONNAIRE_KEYS
from app.classifier import CLASSIFIER_INPUTS

# Deterministic answers filled one-per-turn, in REQUIRED_FIELD_KEYS order.
_CANNED_FIELDS = {
    "submission_type": "Initial Submission (first time registering this AI system)",
    "external_id": "PROJ-4712",
    "use_case_owner": "Jane Smith",
    "use_case_type": "Internal development for own organisational use",
    "department": "HR",
    "technologies": "Large language model (LLM), Python, REST API",
    "use_case_status": "New AI use case",
    "use_case": "Automated shortlisting and CV screening of job applicants for open recruiting positions.",
    "planned_modifications": "N/A",
    "entity_role": "Provider — we develop this AI system and make it available internally or externally",
    "additional_entity_roles": "N/A",
    "used_in_eu": "yes",
    "exception_category": "None of the above",
    "sector_legislation": "None of the above",
}

_PROMPTS = {
    "submission_type": "Is this an initial submission or a resubmission of an existing registration?",
    "external_id": "Do you have an external system ID or ticket number for this AI system? (leave blank if not applicable)",
    "use_case_owner": "Who is the use case owner — the person responsible for this AI system end-to-end?",
    "use_case_type": "How is this system developed? (e.g. internal build, third-party product, partner-developed)",
    "department": "Which department or team is developing or owning this system?",
    "technologies": "What technologies, models, or frameworks does it use?",
    "use_case_status": "Is this a new AI use case or does it already exist in some form?",
    "use_case": "Please provide a detailed description — its purpose, architecture, input/output data, deployment context, and human oversight.",
    "planned_modifications": "Are any architectural or functional changes planned in the next 12–24 months? If none, say N/A.",
    "entity_role": "Is your organisation the Provider (builds/distributes the system) or the Deployer (operates a third-party system)?",
    "additional_entity_roles": "Does your organisation play any additional roles such as Distributor, Importer, or Operator? If none, say N/A.",
    "used_in_eu": "Will this AI system be used, placed on the market, or put into service in the European Union?",
    "exception_category": "Does the system fall into any category exempt from the EU AI Act (e.g. military, R&D, open-source)? If none, say 'None of the above'.",
    "sector_legislation": "Is this system part of a product already regulated by sector-specific EU legislation (e.g. medical devices, machinery)? If none, say 'None of the above'.",
}

_CANNED_BUSINESS = {
    "intended_purpose": "Screens and ranks job applicants to support recruiters.",
    "department": "HR",
    "use_case": "Automated candidate shortlisting for open positions.",
    "people_affected": "Job applicants and hiring managers.",
    "decision_context": "Recommendations reviewed by a human recruiter before final decision.",
    "data_sources": "CV database, LinkedIn profiles, structured assessment scores.",
    "oversight_mechanism": "Recruiter reviews top-20 shortlist before scheduling interviews.",
    "deployment_context": "Internal HR portal, accessible by recruiters in all offices.",
}

_CANNED_TECHNICAL = {f: False for f in sorted(CLASSIFIER_INPUTS)}
_CANNED_TECHNICAL["is_employment_related"] = True
_CANNED_TECHNICAL["training_compute_flops"] = 0.0

_TECHNICAL_FLAGS = sorted(CLASSIFIER_INPUTS)


def _result(text: str) -> dict:
    return {
        "text": text,
        "input_tokens": 0,
        "output_tokens": len(text) // 4,
        "finish_reason": "stop",
    }


def _turn(messages: list[dict]) -> dict:
    user_turns = sum(1 for m in messages if m["role"] == "user")
    idx = min(max(user_turns, 1), len(REQUIRED_FIELD_KEYS)) - 1
    field_key = REQUIRED_FIELD_KEYS[idx]
    extracted = {field_key: _CANNED_FIELDS[field_key]}

    complete = user_turns >= len(REQUIRED_FIELD_KEYS)
    if complete:
        next_field = None
        message = "Thanks — I have everything I need. Here is the preliminary classification."
    else:
        next_field = REQUIRED_FIELD_KEYS[idx + 1]
        message = _PROMPTS.get(next_field, f"Please tell me about {next_field}.")

    return _result(
        json.dumps(
            {
                "message": message,
                "extracted_fields": extracted,
                "next_field": next_field,
                "complete": complete,
            }
        )
    )


def _questionnaire_business_turn(messages: list[dict]) -> dict:
    user_turns = sum(1 for m in messages if m["role"] == "user")
    idx = min(max(user_turns, 1), len(BUSINESS_QUESTIONNAIRE_KEYS)) - 1
    field_key = BUSINESS_QUESTIONNAIRE_KEYS[idx]
    extracted = {field_key: _CANNED_BUSINESS[field_key]}

    complete = user_turns >= len(BUSINESS_QUESTIONNAIRE_KEYS)
    if complete:
        next_field = None
        message = "Great — I have all the business context I need."
    else:
        next_field = BUSINESS_QUESTIONNAIRE_KEYS[idx + 1] if idx + 1 < len(BUSINESS_QUESTIONNAIRE_KEYS) else None
        message = f"Could you tell me about '{next_field}'?" if next_field else "All done."

    return _result(json.dumps({"message": message, "extracted_fields": extracted, "next_field": next_field, "complete": complete}))


def _questionnaire_technical_turn(messages: list[dict]) -> dict:
    user_turns = sum(1 for m in messages if m["role"] == "user")
    idx = min(max(user_turns, 1), len(_TECHNICAL_FLAGS)) - 1
    flag_key = _TECHNICAL_FLAGS[idx]
    extracted = {flag_key: _CANNED_TECHNICAL[flag_key]}

    complete = user_turns >= len(_TECHNICAL_FLAGS)
    if complete:
        next_field = None
        message = "All flags have been determined. Ready to classify."
    else:
        next_field = _TECHNICAL_FLAGS[idx + 1] if idx + 1 < len(_TECHNICAL_FLAGS) else None
        message = f"Does the system have '{next_field}'?"

    return _result(json.dumps({"message": message, "extracted_fields": extracted, "next_field": next_field, "complete": complete}))


def _doc_extract(_messages: list[dict]) -> dict:
    return _result(
        json.dumps(
            {
                "extracted_fields": {
                    "use_case_owner": "Jane Smith",
                    "department": "HR",
                    "technologies": "Large language model (LLM), Python, REST API",
                    "use_case": "Automated shortlisting and CV screening of job applicants for open recruiting positions.",
                    "entity_role": "Provider — we develop this AI system and make it available internally or externally",
                    "used_in_eu": "yes",
                },
                "notes": "Extracted use case owner, department, technologies, description, entity role, and EU usage from the document.",
            }
        )
    )


def _questionnaire_doc_extract(messages: list[dict]) -> dict:
    system_text = " ".join(m.get("content", "") if isinstance(m.get("content"), str) else "" for m in messages).lower()
    if "technical" in system_text or "flag" in system_text or "risk" in system_text:
        return _result(json.dumps({
            "extracted_fields": {"is_employment_related": True},
            "notes": "Identified employment-related use case from document.",
        }))
    return _result(json.dumps({
        "extracted_fields": {
            "intended_purpose": "Screens and ranks job applicants.",
            "department": "HR",
            "use_case": "Automated candidate shortlisting.",
        },
        "notes": "Extracted business context from document.",
    }))


def _infer_flags(messages: list[dict]) -> dict:
    blob = " ".join(
        m["content"] for m in messages if m["role"] == "user" and isinstance(m["content"], str)
    ).lower()
    flags = []
    if any(kw in blob for kw in ("recruit", "employment", "applicant", "hiring")):
        flags.append(
            {
                "flag": "is_employment_related",
                "value": True,
                "rationale": "The system screens and ranks job applicants, an Annex III employment use case.",
                "confidence": 0.9,
            }
        )
    return _result(json.dumps({"inferred_flags": flags}))


def _classify_questionnaire(messages: list[dict]) -> dict:
    """AI-mode authoritative classification: infer flags + reasoning + missing_info + confidence."""
    blob = " ".join(
        m["content"] for m in messages if m["role"] == "user" and isinstance(m["content"], str)
    ).lower()
    flags = []
    if any(kw in blob for kw in ("recruit", "employment", "applicant", "hiring")):
        flags.append(
            {
                "flag": "is_employment_related",
                "value": True,
                "rationale": "The system screens and ranks job applicants, an Annex III employment use case.",
                "confidence": 0.9,
            }
        )
        reasoning = "The answers describe automated candidate screening, an Annex III employment use case, so the system is high-risk."
        missing_info: list[str] = []
        confidence = 0.9
    else:
        reasoning = "No Annex III, prohibited, GPAI, or transparency triggers were evident in the answers; the system appears minimal risk."
        missing_info = ["Confirmation of the deployment context and the population affected."]
        confidence = 0.6
    return _result(
        json.dumps(
            {
                "inferred_flags": flags,
                "reasoning": reasoning,
                "missing_info": missing_info,
                "confidence": confidence,
            }
        )
    )


def chat(messages: list[dict], *, task: str = "chat") -> dict:
    """Synchronous stub dispatch, keyed by task."""
    if task == "turn":
        return _turn(messages)
    if task == "doc_extract":
        return _doc_extract(messages)
    if task == "infer_flags":
        return _infer_flags(messages)
    if task == "classify_questionnaire":
        return _classify_questionnaire(messages)
    if task == "questionnaire_turn_business":
        return _questionnaire_business_turn(messages)
    if task == "questionnaire_turn_technical":
        return _questionnaire_technical_turn(messages)
    if task == "questionnaire_doc_extract":
        return _questionnaire_doc_extract(messages)
    # Repair or unknown task: return a harmless empty object.
    return _result("{}")
