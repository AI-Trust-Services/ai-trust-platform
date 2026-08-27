"""LLM abstraction layer for AI-assisted registration.

Public surface:
  - ``chat`` — provider-dispatched LLM call with a uniform return shape.
  - ``parse_json_response`` / ``LLMParseError`` — JSON parsing with repair retry.
  - ``LLMResponseError`` — raised when the external provider returns an unexpected shape.
  - prompt builders — owner: ``build_turn_messages``, ``build_doc_extract_messages``,
    ``build_infer_flags_messages``; engineer: ``build_engineer_turn_messages``,
    ``build_engineer_doc_extract_messages``; questionnaire: ``build_questionnaire_turn_messages``,
    ``build_questionnaire_extract_messages``.
"""
from app.llm.client import LLM_MODEL, LLM_VISION_MODEL, LLMResponseError, chat
from app.llm.parsing import LLMParseError, parse_json_response
from app.llm.prompts import (
    REQUIRED_FIELD_KEYS,
    TARGET_FIELDS,
    ENGINEER_REQUIRED_FIELD_KEYS,
    ENGINEER_TARGET_FIELDS,
    BUSINESS_QUESTIONNAIRE_FIELDS,
    BUSINESS_QUESTIONNAIRE_KEYS,
    build_doc_extract_messages,
    build_engineer_doc_extract_messages,
    build_engineer_turn_messages,
    build_infer_flags_messages,
    build_turn_messages,
    build_questionnaire_turn_messages,
    build_questionnaire_extract_messages,
)

__all__ = [
    "chat",
    "LLM_MODEL",
    "LLM_VISION_MODEL",
    "parse_json_response",
    "LLMParseError",
    "LLMResponseError",
    "build_turn_messages",
    "build_doc_extract_messages",
    "build_infer_flags_messages",
    "build_engineer_turn_messages",
    "build_engineer_doc_extract_messages",
    "build_questionnaire_turn_messages",
    "build_questionnaire_extract_messages",
    "REQUIRED_FIELD_KEYS",
    "TARGET_FIELDS",
    "ENGINEER_REQUIRED_FIELD_KEYS",
    "ENGINEER_TARGET_FIELDS",
    "BUSINESS_QUESTIONNAIRE_FIELDS",
    "BUSINESS_QUESTIONNAIRE_KEYS",
]
