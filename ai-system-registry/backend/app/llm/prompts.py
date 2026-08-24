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

# The 7 descriptive fields the conversation converges on. Keys are the field
# names carried in the stateless field-state dict and mapped onto columns by
# the router (system_name→name, purpose→intended_purpose,
# human_involvement→autonomy_level; the middle four are their own columns).
TARGET_FIELDS: list[dict[str, str]] = [
    {"key": "system_name", "label": "System Name", "hint": "The name of the AI system."},
    {"key": "purpose", "label": "Purpose", "hint": "What the system does, in 1-2 sentences."},
    {"key": "department", "label": "Department", "hint": "Business area, e.g. HR, Finance, Sales, IT, Legal."},
    {"key": "use_case", "label": "Use Case", "hint": "e.g. recruiting, customer_service, finance, healthcare, legal, marketing, operations, research, other."},
    {"key": "people_affected", "label": "People Affected", "hint": "Who is affected: customers, employees, applicants, partners, public, other."},
    {"key": "decision_context", "label": "Decision Context", "hint": "How the AI affects decisions: supports, influences, automates."},
    {"key": "human_involvement", "label": "Human Involvement", "hint": "Level of oversight: ai_decides, ai_recommends, human_decides."},
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

_TURN_SYSTEM = """You are an AI registration assistant collecting information about an AI system \
for EU AI Act compliance. You drive a short, focused conversation.

Rules:
- Ask ONE question at a time. Be direct and concise — no lengthy explanations.
- Infer values when the user's description makes them obvious (e.g. a hiring tool → department "HR", \
use_case "recruiting", people_affected "applicants"), and briefly confirm what you inferred.
- Never invent a system name — ask for it.
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
