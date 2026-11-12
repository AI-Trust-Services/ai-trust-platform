"""Deterministic stub LLM provider (THALAMUS_BASE_URL unset or "stub", the default everywhere).

Canned responses keyed by task, with light keyword matching on the conversation,
so tests / local dev can drive the full agentic loop with no network. The turn
task walks a fixed "recruiting assistant" (TalentMatch) sequence that converges
to complete in exactly len(REQUIRED_FIELD_KEYS) user turns; infer-flags maps a
recruiting use-case onto is_employment_related=true. The questionnaire tasks walk
their own deterministic sequences.
"""

from __future__ import annotations

import json
import re

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
        message = (
            "Thanks — I have everything I need. Here is the preliminary classification."
        )
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
        next_field = (
            BUSINESS_QUESTIONNAIRE_KEYS[idx + 1]
            if idx + 1 < len(BUSINESS_QUESTIONNAIRE_KEYS)
            else None
        )
        message = (
            f"Could you tell me about '{next_field}'?" if next_field else "All done."
        )

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
        next_field = (
            _TECHNICAL_FLAGS[idx + 1] if idx + 1 < len(_TECHNICAL_FLAGS) else None
        )
        message = f"Does the system have '{next_field}'?"

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
    system_text = " ".join(
        m.get("content", "") if isinstance(m.get("content"), str) else ""
        for m in messages
    ).lower()
    if "technical" in system_text or "flag" in system_text or "risk" in system_text:
        return _result(
            json.dumps(
                {
                    "extracted_fields": {"is_employment_related": True},
                    "notes": "Identified employment-related use case from document.",
                }
            )
        )
    return _result(
        json.dumps(
            {
                "extracted_fields": {
                    "intended_purpose": "Screens and ranks job applicants.",
                    "department": "HR",
                    "use_case": "Automated candidate shortlisting.",
                },
                "notes": "Extracted business context from document.",
            }
        )
    )


def _infer_flags(messages: list[dict]) -> dict:
    blob = " ".join(
        m["content"]
        for m in messages
        if m["role"] == "user" and isinstance(m["content"], str)
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
    """AI-mode authoritative classification: infer flags + reasoning + missing_info + confidence + org_role."""
    blob = " ".join(
        m["content"]
        for m in messages
        if m["role"] == "user" and isinstance(m["content"], str)
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
        missing_info = [
            "Confirmation of the deployment context and the population affected."
        ]
        confidence = 0.6

    if any(
        kw in blob
        for kw in ("built", "develop", "train", "created", "we built", "our model")
    ):
        org_role = "provider"
        org_role_rationale = "The organisation developed or trained the AI system, placing it on the market under its own name."
    elif any(
        kw in blob
        for kw in (
            "third-party",
            "third party",
            "purchased",
            "vendor",
            "use an existing",
        )
    ):
        org_role = "deployer"
        org_role_rationale = "The organisation deploys a third-party AI system in a professional context without being the original developer."
    else:
        org_role = "provider"
        org_role_rationale = "Defaulting to provider as the system appears to be developed by the organisation itself."

    return _result(
        json.dumps(
            {
                "inferred_flags": flags,
                "reasoning": reasoning,
                "missing_info": missing_info,
                "confidence": confidence,
                "org_role": org_role,
                "org_role_rationale": org_role_rationale,
            }
        )
    )


def _questionnaire_answer(_messages: list[dict]) -> dict:
    """Stub for the questionnaire answer pipeline task.

    Returns a minimal valid response matching the output schema defined in the
    questionnaire_answer prompt: one result for Scope_1 with NOT_ENOUGH_INFORMATION
    (no evidence available in stub mode).
    """
    return _result(
        json.dumps(
            {
                "results": [
                    {
                        "questionId": "Scope_1",
                        "question": "Is your system an AI system within the meaning of the AI Act?",
                        "questionType": "PREDEFINED",
                        "answer": [
                            {
                                "value": "NOT_ENOUGH_INFORMATION",
                                "answerStrength": None,
                                "reason": "No sufficient evidence is available in stub mode to determine whether the system qualifies as an AI system under the AI Act.",
                            }
                        ],
                        "explanation": "Stub mode: no real evidence was evaluated. Human verification required.",
                        "references": [],
                    }
                ]
            }
        )
    )


def _assessment_prefill(messages: list[dict]) -> dict:
    """Deterministic assessment prefill: propose an answer + confidence per question.

    Parses the question keys out of the catalogue block in the system prompt
    ("<key> — <label>" lines) and emits a stable answer per key so stub/CI runs
    exercise the confidence bands and the attention count. A constrained question
    (one whose catalogue entry carries an "Answer with EXACTLY one of: ..." line)
    is answered with its FIRST allowed option verbatim, so the frontend's
    exact-match radios select it. A deterministic subset of free-text keys is left
    low-confidence/empty to represent "not enough information".
    """
    system = " ".join(
        m["content"]
        for m in messages
        if m["role"] == "system" and isinstance(m["content"], str)
    )
    # Catalogue lines look like: "Scope_1 — Is your system an AI system...".
    keys = re.findall(r"^([A-Za-z0-9_]+) — ", system, flags=re.MULTILINE)
    # Constrained keys carry a continuation line "Answer with EXACTLY one of: a | b | ...".
    # Map each such key → its first allowed option (verbatim) so the UI selects it.
    opts_by_key: dict[str, str] = {}
    for k, opts in re.findall(
        r"^([A-Za-z0-9_]+) — .*\n\s*Answer with EXACTLY one of: (.+)$",
        system,
        flags=re.MULTILINE,
    ):
        opts_by_key[k] = opts.split(" | ")[0].strip()
    # Free-text keys left empty/low → keeps a non-zero attention count in stub runs.
    low_keys = {"planned_modifications"}
    med_keys = {"technologies", "automation_and_oversight"}
    answers = []
    for k in keys:
        if k in opts_by_key:
            # Constrained (select/boolean) → a valid, UI-selectable option string.
            answers.append(
                {"question_key": k, "answer": opts_by_key[k], "confidence": "high"}
            )
        elif k in low_keys:
            answers.append({"question_key": k, "answer": "", "confidence": "low"})
        elif k in med_keys:
            answers.append(
                {
                    "question_key": k,
                    "answer": f"Proposed answer for {k} (see documents).",
                    "confidence": "medium",
                }
            )
        else:
            answers.append(
                {
                    "question_key": k,
                    "answer": f"Proposed answer for {k} from the uploaded documents.",
                    "confidence": "high",
                }
            )
    return _result(json.dumps({"answers": answers}))


def _risk_role_classification(messages: list[dict]) -> dict:
    """Stub for one active-label classification call (Step 2 pipeline).

    Returns a minimal valid single-label result matching the LLM 2 output schema.
    The label id is extracted from the user message if possible; defaults to HIGH_RISK.
    """
    blob = " ".join(
        m.get("content", "") if isinstance(m.get("content"), str) else ""
        for m in messages
        if m.get("role") == "user"
    )
    # Try to extract the labelId from the CLASSIFICATION_CONFIG block in the user message.
    label_id = "HIGH_RISK"
    import re as _re

    match = _re.search(r'"id"\s*:\s*"([A-Z_]+)"', blob)
    if match:
        label_id = match.group(1)
    return _result(
        json.dumps(
            {
                "classifications": [
                    {
                        "labelId": label_id,
                        "result": False,
                        "confidence": 60.00,
                        "explanation": (
                            "Stub mode: no evidence evaluated. "
                            "Human verification required."
                        ),
                    }
                ]
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
    if task == "assessment_prefill":
        return _assessment_prefill(messages)
    if task == "questionnaire_turn_business":
        return _questionnaire_business_turn(messages)
    if task == "questionnaire_turn_technical":
        return _questionnaire_technical_turn(messages)
    if task == "questionnaire_doc_extract":
        return _questionnaire_doc_extract(messages)
    if task == "questionnaire_answer" or task.startswith("questionnaire_answer_batch"):
        return _questionnaire_answer(messages)
    if task.startswith("risk_role_classification_"):
        return _risk_role_classification(messages)
    # Repair or unknown task: return a harmless empty object.
    return _result("{}")
