"""Structural validators for LLM output schemas.

Each function validates the output of one LLM step against the schema defined
in its system prompt. On any violation it raises ``LLMParseError`` with a
specific field path so ``parse_with_retry`` can include it in the repair prompt.
"""

from __future__ import annotations

from app.llm.parsing import LLMParseError

_QUESTION_TYPES = frozenset({"PREDEFINED", "MULTISELECT", "DESCRIPTIVE"})
_ANSWER_STRENGTHS = frozenset({"HIGH", "MEDIUM", "LOW"})
_SOURCE_TYPES = frozenset({"Document", "Registration Data"})


def validate_questionnaire_batch(raw: dict) -> dict:
    """Strict validator for the questionnaire_answer.md §9 output schema.

    Checks the full structural contract: results list, per-item fields,
    per-answer fields, and per-reference fields.

    Returns ``raw`` unchanged on success.
    Raises ``LLMParseError`` with the field path on first violation.
    """
    results = raw.get("results")
    if not isinstance(results, list) or len(results) == 0:
        raise LLMParseError(
            "results: must be a non-empty array; got "
            + (
                "empty list"
                if isinstance(results, list)
                else repr(type(results).__name__)
            )
        )

    for i, item in enumerate(results):
        if not isinstance(item, dict):
            raise LLMParseError(
                f"results[{i}]: must be an object, got {type(item).__name__}"
            )

        prefix = f"results[{i}]"

        question_id = item.get("questionId")
        if not isinstance(question_id, str) or not question_id:
            raise LLMParseError(f"{prefix}.questionId: must be a non-empty string")

        question = item.get("question")
        if not isinstance(question, str):
            raise LLMParseError(f"{prefix}.question: must be a string")

        q_type = item.get("questionType")
        if q_type not in _QUESTION_TYPES:
            raise LLMParseError(
                f"{prefix}.questionType: must be one of {sorted(_QUESTION_TYPES)}, got {q_type!r}"
            )

        answer = item.get("answer")
        if not isinstance(answer, list) or len(answer) == 0:
            raise LLMParseError(f"{prefix}.answer: must be a non-empty array")

        explanation = item.get("explanation")
        if not isinstance(explanation, str):
            raise LLMParseError(f"{prefix}.explanation: must be a string")

        references = item.get("references")
        if not isinstance(references, list):
            raise LLMParseError(f"{prefix}.references: must be an array")

        for j, ans in enumerate(answer):
            _validate_answer_item(ans, f"{prefix}.answer[{j}]")

        for k, ref in enumerate(references):
            _validate_reference_item(ref, f"{prefix}.references[{k}]")

    return raw


def _validate_answer_item(ans: object, path: str) -> None:
    if not isinstance(ans, dict):
        raise LLMParseError(f"{path}: must be an object, got {type(ans).__name__}")

    value = ans.get("value")
    if not isinstance(value, str) or not value:
        raise LLMParseError(f"{path}.value: must be a non-empty string")

    strength = ans.get("answerStrength")
    if strength is not None and strength not in _ANSWER_STRENGTHS:
        raise LLMParseError(
            f"{path}.answerStrength: must be one of {sorted(_ANSWER_STRENGTHS)} or null, got {strength!r}"
        )

    reason = ans.get("reason")
    if reason is not None and not isinstance(reason, str):
        raise LLMParseError(f"{path}.reason: must be a string or null")


def _validate_reference_item(ref: object, path: str) -> None:
    if not isinstance(ref, dict):
        raise LLMParseError(f"{path}: must be an object, got {type(ref).__name__}")

    source_type = ref.get("sourceType")
    if source_type not in _SOURCE_TYPES:
        raise LLMParseError(
            f"{path}.sourceType: must be one of {sorted(_SOURCE_TYPES)}, got {source_type!r}"
        )

    source = ref.get("source")
    if not isinstance(source, str) or not source:
        raise LLMParseError(f"{path}.source: must be a non-empty string")

    for nullable_field in ("sourceId", "location", "quote"):
        val = ref.get(nullable_field)
        if val is not None and not isinstance(val, str):
            raise LLMParseError(f"{path}.{nullable_field}: must be a string or null")


def validate_classification_label(raw: dict) -> dict:
    """Strict validator for the risk_role_classification.md §12 output schema.

    Checks the single-item classifications array and all required fields,
    including type-checking result (bool) and confidence (0-100 number).

    Returns ``raw`` unchanged on success.
    Raises ``LLMParseError`` with the field path on first violation.
    """
    classifications = raw.get("classifications")
    if not isinstance(classifications, list) or len(classifications) == 0:
        raise LLMParseError(
            "classifications: must be a non-empty array; got "
            + (
                "empty list"
                if isinstance(classifications, list)
                else repr(type(classifications).__name__)
            )
        )

    entry = classifications[0]
    if not isinstance(entry, dict):
        raise LLMParseError(
            f"classifications[0]: must be an object, got {type(entry).__name__}"
        )

    label_id = entry.get("labelId")
    if not isinstance(label_id, str) or not label_id:
        raise LLMParseError("classifications[0].labelId: must be a non-empty string")

    result = entry.get("result")
    if not isinstance(result, bool):
        raise LLMParseError(
            f"classifications[0].result: must be a boolean (true/false), got {type(result).__name__} {result!r}"
        )

    confidence = entry.get("confidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        raise LLMParseError(
            f"classifications[0].confidence: must be a number, got {type(confidence).__name__}"
        )
    if not (0 <= confidence <= 100):
        raise LLMParseError(
            f"classifications[0].confidence: must be between 0 and 100, got {confidence}"
        )

    explanation = entry.get("explanation")
    if not isinstance(explanation, str) or not explanation:
        raise LLMParseError(
            "classifications[0].explanation: must be a non-empty string"
        )

    return raw
