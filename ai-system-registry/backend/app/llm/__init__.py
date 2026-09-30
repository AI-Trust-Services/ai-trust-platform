"""LLM abstraction layer for AI-assisted registration.

Public surface:
  - ``chat`` — Thalamus inference call with a uniform return shape.
  - ``parse_json_response`` / ``LLMParseError`` — JSON parsing with repair retry.
  - prompt builders — owner: ``build_turn_messages``, ``build_doc_extract_messages``,
    ``build_infer_flags_messages``; engineer: ``build_engineer_turn_messages``,
    ``build_engineer_doc_extract_messages``; questionnaire: ``build_questionnaire_turn_messages``,
    ``build_questionnaire_extract_messages``.
"""

from app.llm.client import THALAMUS_MODEL, THALAMUS_VISION_MODEL, chat
from app.llm.parsing import LLMParseError, parse_json_response
from app.llm.prompts import (
    BUSINESS_QUESTIONNAIRE_FIELDS,
    BUSINESS_QUESTIONNAIRE_KEYS,
    ENGINEER_REQUIRED_FIELD_KEYS,
    ENGINEER_TARGET_FIELDS,
    REQUIRED_FIELD_KEYS,
    TARGET_FIELDS,
    build_classify_questionnaire_messages,
    build_doc_extract_messages,
    build_engineer_doc_extract_messages,
    build_engineer_turn_messages,
    build_infer_flags_messages,
    build_questionnaire_extract_messages,
    build_questionnaire_turn_messages,
    build_turn_messages,
)

__all__ = [
    "BUSINESS_QUESTIONNAIRE_FIELDS",
    "BUSINESS_QUESTIONNAIRE_KEYS",
    "ENGINEER_REQUIRED_FIELD_KEYS",
    "ENGINEER_TARGET_FIELDS",
    "REQUIRED_FIELD_KEYS",
    "TARGET_FIELDS",
    "THALAMUS_MODEL",
    "THALAMUS_VISION_MODEL",
    "LLMParseError",
    "build_classify_questionnaire_messages",
    "build_doc_extract_messages",
    "build_engineer_doc_extract_messages",
    "build_engineer_turn_messages",
    "build_infer_flags_messages",
    "build_questionnaire_extract_messages",
    "build_questionnaire_turn_messages",
    "build_turn_messages",
    "chat",
    "parse_json_response",
]
