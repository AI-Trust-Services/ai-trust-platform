"""Per-task prompt builders for AI-assisted registration.

Each builder targets a narrow JSON schema so the model output maps 1:1 onto
columns / classifier flags. Three tasks (design Q11):
  - turn        : bounded-agentic conversation, one JSON object per turn
  - doc_extract : field extraction from a parsed document / image
  - infer_flags : classifier-flag inference, run once at completion

Two role variants for turn/doc_extract: owner (plain-language, 7 fields) and
engineer (technical tone, 8 fields).
"""
from __future__ import annotations

import json
from typing import Any

from app.classifier import CLASSIFIER_INPUTS

# The 14 descriptive fields the owner questionnaire conversation converges on.
# Keys match the frontend questionnaire.ts BUSINESS_QUESTIONS keys.
# Fields with storage="system" map to top-level ai_systems columns;
# the rest are stored in questionnaire_answers JSONB.
TARGET_FIELDS: list[dict[str, str]] = [
    {"key": "submission_type", "label": "Type of Submission", "hint": "Is this the first time registering this AI system, or a resubmission?"},
    {"key": "external_id", "label": "External System ID", "hint": "ID in an external register or ticketing system, if applicable. Leave blank if not applicable."},
    {"key": "use_case_owner", "label": "Use Case Owner", "hint": "Name of the person responsible for delivering this AI system end-to-end."},
    {"key": "use_case_type", "label": "Type of Use Case", "hint": "How is this AI system developed and deployed? e.g. internal development, third-party product, customer-specific, partner-developed."},
    {"key": "department", "label": "Developing Business Unit", "hint": "Which department, team, or line of business develops or owns this AI system?"},
    {"key": "technologies", "label": "Technologies Involved", "hint": "Main technologies, models, frameworks, or platforms used (e.g. LLMs, ML models, APIs, cloud services)."},
    {"key": "use_case_status", "label": "Status of AI Use Case", "hint": "Is this a new AI use case or does it already exist?"},
    {"key": "use_case", "label": "Detailed Description", "hint": "Describe the system: architecture overview, purpose and goals, input/output data, deployment timeline, human oversight, and development stage."},
    {"key": "planned_modifications", "label": "Planned Changes (12–24 months)", "hint": "Any architectural or functional changes planned in the next 12–24 months? If none, write N/A."},
    {"key": "entity_role", "label": "Organisation's Role", "hint": "Is your organisation the Provider (develops/makes available) or the Deployer (operates a third-party system for own purposes)?"},
    {"key": "additional_entity_roles", "label": "Additional Roles", "hint": "Does your organisation also act as Distributor, Importer, Authorised Representative, or Operator? Describe, or write N/A."},
    {"key": "used_in_eu", "label": "Used in the EU", "hint": "Will this AI system be used, placed on the market, or put into service in the European Union? Answer yes or no."},
    {"key": "exception_category", "label": "Exception Category", "hint": "Does the system fall into any category fully out of scope of the EU AI Act (e.g. military use, pure R&D, open-source)? If none, say None of the above."},
    {"key": "sector_legislation", "label": "Sector-Specific Legislation", "hint": "Is this system part of a product regulated by existing EU sector legislation (e.g. medical devices, machinery)? If none, say None of the above."},
]

REQUIRED_FIELD_KEYS: list[str] = [f["key"] for f in TARGET_FIELDS]

# Sorted for deterministic prompt text.
_FLAG_NAMES = sorted(CLASSIFIER_INPUTS)


def _field_state_block(fields: dict[str, Any]) -> str:
    lines = []
    for f in TARGET_FIELDS:
        value = fields.get(f["key"])
        lines.append(f"- {f['key']}: {value if value not in (None, '') else '(not set)'}")
    return "\n".join(lines)


def _target_schema_block() -> str:
    return "\n".join(f"- {f['key']} — {f['hint']}" for f in TARGET_FIELDS)


# ---------------------------------------------------------------------------
# Turn extraction (conversation)
# ---------------------------------------------------------------------------

_TURN_SYSTEM = """You are an AI registration assistant helping complete an EU AI Act registration \
questionnaire for an AI system. You drive a short, focused conversation.

Rules:
- Ask ONE question at a time. Be direct and concise — no lengthy explanations.
- Infer values when the user's description makes them obvious (e.g. a recruiting tool → department "HR", \
use_case_type "Internal development for own organisational use") and briefly confirm what you inferred.
- All fields are optional — if the user says they don't know or want to skip a field, move on.
- Only ask about fields that are still "(not set)".

Target fields to collect:
{target_schema}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"message": "<your next question or acknowledgement>", "extracted_fields": {{<field:value pairs you learned this turn>}}, "next_field": "<the field key you are asking about, or null>", "complete": <true|false>}}

Set "complete": true only once every target field is filled (either from the user or confidently inferred). \
Use the exact field keys shown above."""


def build_turn_messages(transcript: list[dict], fields: dict[str, Any]) -> list[dict]:
    """Messages for a conversation turn. ``transcript`` is [{role, content}, ...]."""
    system = _TURN_SYSTEM.format(target_schema=_target_schema_block())
    system += "\n\n## Current field state:\n" + _field_state_block(fields)
    messages = [{"role": "system", "content": system}]
    messages.extend({"role": m["role"], "content": m["content"]} for m in transcript)
    return messages


# ---------------------------------------------------------------------------
# Document extraction
# ---------------------------------------------------------------------------

_DOC_SYSTEM = """You are an AI documentation analyst. Extract information about an AI system from the \
provided document for EU AI Act registration.

Target fields to extract (only include the ones you can confidently determine):
{target_schema}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"extracted_fields": {{<field:value pairs>}}, "notes": "<one short sentence on what you found>"}}

Use the exact field keys shown above."""


def build_doc_extract_messages(parsed_text: str | None = None, image_b64: str | None = None, media_type: str | None = None) -> list[dict]:
    """Messages for document extraction. Pass ``parsed_text`` for docs, ``image_b64`` for images."""
    system = _DOC_SYSTEM.format(target_schema=_target_schema_block())
    messages = [{"role": "system", "content": system}]
    if image_b64:
        # OpenAI-compatible multimodal content (also accepted by the external adapter path).
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract AI system information from this document image."},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type or 'image/png'};base64,{image_b64}"},
                    },
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": f"Extract AI system information from this document:\n\n{parsed_text or ''}"})
    return messages


# ---------------------------------------------------------------------------
# Flag inference (at completion)
# ---------------------------------------------------------------------------

_INFER_SYSTEM = """You are an EU AI Act classification analyst. Given the collected fields describing \
an AI system, decide which boolean classifier flags apply. Do NOT decide the risk tier — a \
deterministic classifier does that from your flags.

Only set a flag when the evidence supports it. Boolean flags default to false; \
training_compute_flops is a number (0 if unknown).

Available classifier flags:
{flag_names}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"inferred_flags": [{{"flag": "<flag name>", "value": <true|false|number>, "rationale": "<one sentence>", "confidence": <0.0-1.0>}}]}}

Include an entry ONLY for flags you are setting to true (or, for training_compute_flops, a non-zero number). \
Use the exact flag names shown above."""


def build_infer_flags_messages(fields: dict[str, Any]) -> list[dict]:
    """Messages for the completion-time flag-inference step."""
    system = _INFER_SYSTEM.format(flag_names="\n".join(f"- {n}" for n in _FLAG_NAMES))
    user = "Collected fields:\n" + json.dumps(fields, indent=2, ensure_ascii=False)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# ---------------------------------------------------------------------------
# Engineer turn + doc_extract (technical tone, 8 fields)
# ---------------------------------------------------------------------------

ENGINEER_TARGET_FIELDS: list[dict[str, str]] = [
    {"key": "description", "label": "Description", "hint": "Brief technical description of the AI system."},
    {"key": "intended_purpose", "label": "Intended Purpose", "hint": "Intended purpose and deployment context."},
    {"key": "version", "label": "Version", "hint": "Version string, e.g. 1.0.0, 2.1, 3.0-beta."},
    {"key": "provider", "label": "Provider", "hint": "Name of the organisation or team that built the model/system."},
    {"key": "org_name", "label": "Organisation Name", "hint": "Legal or business name of the deploying organisation."},
    {"key": "system_type", "label": "System Type", "hint": "One of: application, model, component, service."},
    {"key": "lifecycle", "label": "Lifecycle State", "hint": "One of: development, testing, conformity, market."},
    {"key": "autonomy_level", "label": "Autonomy Level", "hint": "One of: decision_support, human_in_the_loop, human_on_the_loop, fully_automated."},
]

ENGINEER_REQUIRED_FIELD_KEYS: list[str] = [f["key"] for f in ENGINEER_TARGET_FIELDS]

_ENGINEER_TURN_SYSTEM = """You are an AI registration assistant helping an AI Engineer complete the \
technical registration of an AI system for EU AI Act compliance.

Rules:
- Use precise technical language appropriate for an engineer audience.
- Ask ONE question at a time. Be direct and concise.
- Infer values when the context makes them unambiguous (e.g. "still in development" → lifecycle "development", \
"REST API wrapper" → system_type "service") and briefly confirm what you inferred.
- For enum fields, map natural language to the allowed value — never ask the engineer to pick from a list unless necessary.
- Only ask about fields that are still "(not set)".

Target fields to collect:
{target_schema}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"message": "<your next question or acknowledgement>", "extracted_fields": {{<field:value pairs you learned this turn>}}, "next_field": "<the field key you are asking about, or null>", "complete": <true|false>}}

Set "complete": true only once every target field is filled (either from the engineer or confidently inferred). \
Use the exact field keys shown above."""

_ENGINEER_DOC_SYSTEM = """You are an AI documentation analyst. Extract technical registration information \
about an AI system from the provided document for EU AI Act compliance.

Target fields to extract (only include the ones you can confidently determine):
{target_schema}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"extracted_fields": {{<field:value pairs>}}, "notes": "<one short sentence on what you found>"}}

For enum fields use only these allowed values:
- system_type: application | model | component | service
- lifecycle: development | testing | conformity | market
- autonomy_level: decision_support | human_in_the_loop | human_on_the_loop | fully_automated

Use the exact field keys shown above."""


def _engineer_field_state_block(fields: dict[str, Any]) -> str:
    lines = []
    for f in ENGINEER_TARGET_FIELDS:
        value = fields.get(f["key"])
        lines.append(f"- {f['key']}: {value if value not in (None, '') else '(not set)'}")
    return "\n".join(lines)


def _engineer_target_schema_block() -> str:
    return "\n".join(f"- {f['key']} — {f['hint']}" for f in ENGINEER_TARGET_FIELDS)


def build_engineer_turn_messages(transcript: list[dict], fields: dict[str, Any]) -> list[dict]:
    """Messages for one engineer conversation turn."""
    system = _ENGINEER_TURN_SYSTEM.format(target_schema=_engineer_target_schema_block())
    system += "\n\n## Current field state:\n" + _engineer_field_state_block(fields)
    messages = [{"role": "system", "content": system}]
    messages.extend({"role": m["role"], "content": m["content"]} for m in transcript)
    return messages


def build_engineer_doc_extract_messages(
    parsed_text: str | None = None,
    image_b64: str | None = None,
    media_type: str | None = None,
) -> list[dict]:
    """Messages for engineer document extraction."""
    system = _ENGINEER_DOC_SYSTEM.format(target_schema=_engineer_target_schema_block())
    messages = [{"role": "system", "content": system}]
    if image_b64:
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract AI system technical information from this document image."},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type or 'image/png'};base64,{image_b64}"},
                    },
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": f"Extract AI system technical information from this document:\n\n{parsed_text or ''}"})
    return messages


# ---------------------------------------------------------------------------
# Questionnaire turn + doc_extract (section-aware: business or technical)
# ---------------------------------------------------------------------------

BUSINESS_QUESTIONNAIRE_FIELDS: list[dict[str, str]] = [
    {"key": "intended_purpose", "label": "Primary Purpose", "hint": "What is the primary purpose of this AI system?"},
    {"key": "department", "label": "Owning Department", "hint": "Which department or business unit owns this system?"},
    {"key": "use_case", "label": "Use Case", "hint": "Describe the specific use case this system addresses."},
    {"key": "people_affected", "label": "People Affected", "hint": "Who is affected by this system's decisions or outputs?"},
    {"key": "decision_context", "label": "Decision Context", "hint": "How are the system's outputs used in decision-making?"},
    {"key": "data_sources", "label": "Data Sources", "hint": "What data sources or inputs does the system use?"},
    {"key": "oversight_mechanism", "label": "Human Oversight", "hint": "What human oversight or review mechanisms exist?"},
    {"key": "deployment_context", "label": "Deployment Context", "hint": "Where and how is this system deployed or accessed?"},
]

BUSINESS_QUESTIONNAIRE_KEYS: list[str] = [f["key"] for f in BUSINESS_QUESTIONNAIRE_FIELDS]

# Technical section reuses CLASSIFIER_INPUTS (boolean flags) as target fields.
# Plain-language labels for prompt clarity.
_TECHNICAL_FLAG_LABELS: dict[str, str] = {
    "subliminal_manipulation": "Does it manipulate users subliminally or exploit vulnerabilities?",
    "exploits_vulnerability": "Does it exploit vulnerabilities of specific groups?",
    "social_scoring_public": "Is it used for social scoring of natural persons by public authorities?",
    "real_time_biometric_public": "Does it use real-time remote biometric identification in public spaces?",
    "emotion_recognition_workplace": "Does it perform emotion recognition in workplace or educational settings?",
    "untargeted_facial_scraping": "Does it scrape facial images from the internet or CCTV untargeted?",
    "predictive_policing": "Does it make individual crime risk assessments (predictive policing)?",
    "biometric_categorisation_sensitive": "Does it categorise people by sensitive biometric attributes?",
    "is_biometric_identification": "Is it used for biometric identification?",
    "is_critical_infrastructure": "Does it manage or operate critical infrastructure?",
    "is_education_related": "Is it used in education or vocational training?",
    "is_employment_related": "Is it used in employment, worker management, or access to self-employment?",
    "is_credit_scoring": "Is it used for credit scoring or assessing creditworthiness?",
    "is_public_service": "Is it used for access to essential public services or benefits?",
    "is_law_enforcement": "Is it used by law enforcement for risk assessment, polygraphs, or evidence evaluation?",
    "is_migration": "Is it used in migration, asylum, or border control?",
    "is_judicial_admin": "Is it used to assist courts or in the administration of justice?",
    "is_gpai": "Is this a General-Purpose AI (GPAI) model?",
    "training_compute_flops": "Estimated training compute in FLOPs (0 if unknown).",
    "is_chatbot": "Is it a chatbot or conversational AI system?",
    "generates_synthetic_content": "Does it generate synthetic content (text, images, audio, video)?",
}


def _business_field_state_block(fields: dict[str, Any], existing_data: dict[str, Any]) -> str:
    merged = {**existing_data, **fields}
    lines = []
    for f in BUSINESS_QUESTIONNAIRE_FIELDS:
        value = merged.get(f["key"])
        lines.append(f"- {f['key']}: {value if value not in (None, '') else '(not set)'}")
    return "\n".join(lines)


def _business_target_schema_block() -> str:
    return "\n".join(f"- {f['key']} — {f['hint']}" for f in BUSINESS_QUESTIONNAIRE_FIELDS)


def _technical_field_state_block(fields: dict[str, Any], existing_flags: dict[str, Any]) -> str:
    merged = {**existing_flags, **fields}
    lines = []
    for flag in _FLAG_NAMES:
        value = merged.get(flag)
        label = _TECHNICAL_FLAG_LABELS.get(flag, flag)
        lines.append(f"- {flag} ({label}): {value if value is not None else '(not set)'}")
    return "\n".join(lines)


_BUSINESS_TURN_SYSTEM = """You are an AI compliance assistant helping complete the 'Use Case & Context' section \
of an EU AI Act registration questionnaire. You drive a short, focused conversation with a business representative.

Rules:
- Ask ONE question at a time. Be direct and concise — no lengthy explanations.
- Infer values when the user's description makes them obvious and briefly confirm what you inferred.
- Only ask about fields that are still "(not set)".
- Use plain business language (avoid technical jargon).

Target fields to collect:
{target_schema}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"message": "<your next question or acknowledgement>", "extracted_fields": {{<field:value pairs you learned this turn>}}, "next_field": "<the field key you are asking about, or null>", "complete": <true|false>}}

Set "complete": true only once every target field is filled. Use the exact field keys shown above."""

_TECHNICAL_TURN_SYSTEM = """You are an EU AI Act compliance assistant helping complete the 'AI Risk Classification' section \
of a registration questionnaire. You drive a short, focused conversation with a technical expert.

Rules:
- Ask ONE question at a time. Use precise technical language.
- For boolean flags, interpret natural language answers as true/false.
- Infer flag values when the context makes them unambiguous and briefly confirm.
- Only ask about flags that are still "(not set)".

Target flags to determine (all boolean unless noted):
{flag_schema}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"message": "<your next question or acknowledgement>", "extracted_fields": {{<flag:value pairs you determined this turn>}}, "next_field": "<the flag key you are asking about, or null>", "complete": <true|false>}}

Set "complete": true only once every flag has been determined (true, false, or 0 for training_compute_flops). \
Use the exact flag keys shown above."""

_BUSINESS_DOC_SYSTEM = """You are an AI documentation analyst. Extract 'Use Case & Context' information \
about an AI system from the provided document for EU AI Act registration.

Target fields to extract (only include the ones you can confidently determine):
{target_schema}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"extracted_fields": {{<field:value pairs>}}, "notes": "<one short sentence on what you found>"}}

Use the exact field keys shown above."""

_TECHNICAL_DOC_SYSTEM = """You are an AI documentation analyst. Extract EU AI Act risk classification flags \
from the provided document. These are used to determine the regulatory tier of the AI system.

Target flags to extract (boolean unless noted — only include ones you can confidently determine):
{flag_schema}

You MUST respond with a SINGLE JSON object and nothing else, in this exact shape:
{{"extracted_fields": {{<flag:value pairs>}}, "notes": "<one short sentence on what you found>"}}

Use the exact flag keys shown above. For boolean flags use true/false."""


def build_questionnaire_turn_messages(
    section: str,
    transcript: list[dict],
    fields: dict[str, Any],
    existing_data: dict[str, Any],
) -> list[dict]:
    """Messages for a questionnaire chatbot turn. ``section`` is 'business' or 'technical'."""
    if section == "business":
        system = _BUSINESS_TURN_SYSTEM.format(target_schema=_business_target_schema_block())
        system += "\n\n## Current field state:\n" + _business_field_state_block(fields, existing_data)
    else:
        flag_schema = "\n".join(f"- {k} — {v}" for k, v in _TECHNICAL_FLAG_LABELS.items())
        system = _TECHNICAL_TURN_SYSTEM.format(flag_schema=flag_schema)
        system += "\n\n## Current flag state:\n" + _technical_field_state_block(fields, existing_data)

    messages = [{"role": "system", "content": system}]
    messages.extend({"role": m["role"], "content": m["content"]} for m in transcript)
    return messages


def build_questionnaire_extract_messages(
    section: str,
    parsed_text: str | None = None,
    image_b64: str | None = None,
    media_type: str | None = None,
) -> list[dict]:
    """Messages for questionnaire document extraction."""
    if section == "business":
        system = _BUSINESS_DOC_SYSTEM.format(target_schema=_business_target_schema_block())
        user_text = "Extract AI system business/use-case information from this document"
    else:
        flag_schema = "\n".join(f"- {k} — {v}" for k, v in _TECHNICAL_FLAG_LABELS.items())
        system = _TECHNICAL_DOC_SYSTEM.format(flag_schema=flag_schema)
        user_text = "Extract EU AI Act risk classification information from this document"

    messages = [{"role": "system", "content": system}]
    if image_b64:
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"{user_text} image."},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type or 'image/png'};base64,{image_b64}"},
                    },
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": f"{user_text}:\n\n{parsed_text or ''}"})
    return messages
