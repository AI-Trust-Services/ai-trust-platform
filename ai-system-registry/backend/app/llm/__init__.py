"""LLM abstraction layer for AI-assisted registration.

Public surface:
  - ``chat`` — provider-dispatched LLM call with a uniform return shape.
  - ``get_vision_model`` / ``get_model`` — async helpers to get configured model names.
  - ``invalidate_config_cache`` — invalidate cached config for immediate settings refresh.
  - ``parse_json_response`` / ``LLMParseError`` — JSON parsing with repair retry.
  - ``LLMResponseError`` — raised when the external provider returns an unexpected shape.
  - prompt builders — owner: ``build_turn_messages``, ``build_doc_extract_messages``,
    ``build_infer_flags_messages``; engineer: ``build_engineer_turn_messages``,
    ``build_engineer_doc_extract_messages``.
"""
from app.llm.client import (
    LLMResponseError,
    chat,
    get_model,
    get_vision_model,
    invalidate_config_cache,
)
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
    "get_model",
    "get_vision_model",
    "invalidate_config_cache",
    "parse_json_response",
    "LLMParseError",
    "LLMResponseError",
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
