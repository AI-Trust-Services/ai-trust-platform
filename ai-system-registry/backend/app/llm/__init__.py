"""LLM abstraction layer for AI-assisted registration.

Public surface:
  - ``chat`` — provider-dispatched LLM call with a uniform return shape.
  - ``parse_json_response`` / ``LLMParseError`` — JSON parsing with repair retry.
  - prompt builders — owner: ``build_turn_messages``, ``build_doc_extract_messages``,
    ``build_infer_flags_messages``; engineer: ``build_engineer_turn_messages``,
    ``build_engineer_doc_extract_messages``.
"""
from app.llm.client import LLM_EMBED_MODEL, LLM_MODEL, LLM_VISION_MODEL, chat
from app.llm.parsing import LLMParseError, parse_json_response
from app.llm.prompts import (
    REQUIRED_FIELD_KEYS,
    TARGET_FIELDS,
    ENGINEER_REQUIRED_FIELD_KEYS,
    ENGINEER_TARGET_FIELDS,
    build_doc_extract_messages,
    build_engineer_doc_extract_messages,
    build_engineer_turn_messages,
    build_infer_flags_messages,
    build_turn_messages,
)

__all__ = [
    "chat",
    "LLM_MODEL",
    "LLM_EMBED_MODEL",
    "LLM_VISION_MODEL",
    "parse_json_response",
    "LLMParseError",
    "build_turn_messages",
    "build_doc_extract_messages",
    "build_infer_flags_messages",
    "build_engineer_turn_messages",
    "build_engineer_doc_extract_messages",
    "REQUIRED_FIELD_KEYS",
    "TARGET_FIELDS",
    "ENGINEER_REQUIRED_FIELD_KEYS",
    "ENGINEER_TARGET_FIELDS",
]
