"""Deterministic stub LLM provider (LLM_PROVIDER=stub, the default everywhere).

Canned responses keyed by task, with light keyword matching on the conversation,
so tests / local dev can drive the full agentic loop with no network. The turn
task walks a fixed "recruiting assistant" (TalentMatch) sequence that converges
to complete in exactly len(REQUIRED_FIELD_KEYS) user turns; infer-flags maps a
recruiting use-case onto is_employment_related=true.
"""
from __future__ import annotations

import json

from app.llm.prompts import REQUIRED_FIELD_KEYS

# Deterministic answers filled one-per-turn, in REQUIRED_FIELD_KEYS order.
_CANNED_FIELDS = {
    "system_name": "TalentMatch",
    "purpose": "Screens and ranks job applicants to support recruiters.",
    "department": "HR",
    "use_case": "recruiting",
    "people_affected": "applicants",
    "decision_context": "influences",
    "human_involvement": "ai_recommends",
}

_PROMPTS = {
    "purpose": "In one sentence, what does the system do?",
    "department": "Which department owns this system?",
    "use_case": "What is the primary use case?",
    "people_affected": "Who is primarily affected by its decisions?",
    "decision_context": "Does the AI support, influence, or automate decisions?",
    "human_involvement": "What level of human oversight applies?",
}


def _result(text: str) -> dict:
    return {
        "text": text,
        "input_tokens": 0,
        "output_tokens": len(text) // 4,
        "finish_reason": "stop",
    }


def _turn(messages: list[dict]) -> dict:
    user_turns = sum(1 for m in messages if m["role"] == "user")
    # Turn k extracts the k-th target field (1-indexed) from what the user just said.
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


def _doc_extract(messages: list[dict]) -> dict:
    # A partial extraction so the flow still falls into chat to fill the gaps.
    return _result(
        json.dumps(
            {
                "extracted_fields": {
                    "system_name": "TalentMatch",
                    "purpose": "Screens and ranks job applicants to support recruiters.",
                    "department": "HR",
                },
                "notes": "Extracted the system name, purpose, and owning department from the document.",
            }
        )
    )


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


def chat(messages: list[dict], *, task: str = "chat") -> dict:
    """Synchronous stub dispatch, keyed by task."""
    if task == "turn":
        return _turn(messages)
    if task == "doc_extract":
        return _doc_extract(messages)
    if task == "infer_flags":
        return _infer_flags(messages)
    # Repair or unknown task: return a harmless empty object.
    return _result("{}")
