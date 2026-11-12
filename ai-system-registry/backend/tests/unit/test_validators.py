"""Unit tests for app/llm/validators.py."""

from __future__ import annotations

import pytest

from app.llm.parsing import LLMParseError
from app.llm.validators import (
    validate_classification_label,
    validate_questionnaire_batch,
)

# ---------------------------------------------------------------------------
# Fixtures: minimal valid objects
# ---------------------------------------------------------------------------

_VALID_REFERENCE = {
    "sourceType": "Document",
    "source": "EU AI Act Annex III",
    "sourceId": None,
    "location": None,
    "quote": None,
}

_VALID_ANSWER = {"value": "YES", "answerStrength": "HIGH", "reason": "Clearly stated."}

_VALID_RESULT = {
    "questionId": "Scope_1",
    "question": "Is this an AI system?",
    "questionType": "PREDEFINED",
    "answer": [_VALID_ANSWER],
    "explanation": "System exhibits AI characteristics.",
    "references": [_VALID_REFERENCE],
}

_VALID_QUESTIONNAIRE = {"results": [_VALID_RESULT]}

_VALID_CLASSIFICATION_ENTRY = {
    "labelId": "HIGH_RISK",
    "result": True,
    "confidence": 85,
    "explanation": "System falls under Annex III category 6.",
}

_VALID_CLASSIFICATION = {"classifications": [_VALID_CLASSIFICATION_ENTRY]}


# ---------------------------------------------------------------------------
# validate_questionnaire_batch — happy path
# ---------------------------------------------------------------------------


def test_valid_questionnaire_passes():
    result = validate_questionnaire_batch(_VALID_QUESTIONNAIRE)
    assert result is _VALID_QUESTIONNAIRE


def test_empty_references_allowed():
    raw = {"results": [{**_VALID_RESULT, "references": []}]}
    validate_questionnaire_batch(raw)  # no exception


def test_null_answer_strength_allowed():
    raw = {
        "results": [
            {
                **_VALID_RESULT,
                "answer": [
                    {
                        "value": "NOT_ENOUGH_INFORMATION",
                        "answerStrength": None,
                        "reason": None,
                    }
                ],
            }
        ]
    }
    validate_questionnaire_batch(raw)


def test_multiselect_type_accepted():
    raw = {"results": [{**_VALID_RESULT, "questionType": "MULTISELECT"}]}
    validate_questionnaire_batch(raw)


def test_descriptive_type_accepted():
    raw = {"results": [{**_VALID_RESULT, "questionType": "DESCRIPTIVE"}]}
    validate_questionnaire_batch(raw)


# ---------------------------------------------------------------------------
# validate_questionnaire_batch — missing / wrong fields
# ---------------------------------------------------------------------------


def test_missing_results_raises():
    with pytest.raises(LLMParseError, match="results"):
        validate_questionnaire_batch({})


def test_empty_results_raises():
    with pytest.raises(LLMParseError, match="results"):
        validate_questionnaire_batch({"results": []})


def test_missing_question_id_raises():
    bad = {"results": [{**_VALID_RESULT, "questionId": ""}]}
    with pytest.raises(LLMParseError, match="questionId"):
        validate_questionnaire_batch(bad)


def test_missing_question_field_raises():
    bad = {"results": [{**_VALID_RESULT, "question": 42}]}
    with pytest.raises(LLMParseError, match="question"):
        validate_questionnaire_batch(bad)


def test_invalid_question_type_raises():
    bad = {"results": [{**_VALID_RESULT, "questionType": "UNKNOWN"}]}
    with pytest.raises(LLMParseError, match="questionType"):
        validate_questionnaire_batch(bad)


def test_empty_answer_array_raises():
    bad = {"results": [{**_VALID_RESULT, "answer": []}]}
    with pytest.raises(LLMParseError, match="answer"):
        validate_questionnaire_batch(bad)


def test_invalid_answer_strength_raises():
    bad = {
        "results": [
            {
                **_VALID_RESULT,
                "answer": [
                    {"value": "YES", "answerStrength": "VERY_HIGH", "reason": None}
                ],
            }
        ]
    }
    with pytest.raises(LLMParseError, match="answerStrength"):
        validate_questionnaire_batch(bad)


def test_invalid_source_type_raises():
    bad_ref = {**_VALID_REFERENCE, "sourceType": "Spreadsheet"}
    bad = {"results": [{**_VALID_RESULT, "references": [bad_ref]}]}
    with pytest.raises(LLMParseError, match="sourceType"):
        validate_questionnaire_batch(bad)


def test_empty_source_string_raises():
    bad_ref = {**_VALID_REFERENCE, "source": ""}
    bad = {"results": [{**_VALID_RESULT, "references": [bad_ref]}]}
    with pytest.raises(LLMParseError, match="source"):
        validate_questionnaire_batch(bad)


def test_non_string_nullable_field_raises():
    bad_ref = {**_VALID_REFERENCE, "quote": 123}
    bad = {"results": [{**_VALID_RESULT, "references": [bad_ref]}]}
    with pytest.raises(LLMParseError, match="quote"):
        validate_questionnaire_batch(bad)


# ---------------------------------------------------------------------------
# validate_classification_label — happy path
# ---------------------------------------------------------------------------


def test_valid_classification_passes():
    result = validate_classification_label(_VALID_CLASSIFICATION)
    assert result is _VALID_CLASSIFICATION


def test_confidence_zero_allowed():
    raw = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "confidence": 0}]}
    validate_classification_label(raw)


def test_confidence_100_allowed():
    raw = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "confidence": 100}]}
    validate_classification_label(raw)


def test_result_false_allowed():
    raw = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "result": False}]}
    validate_classification_label(raw)


# ---------------------------------------------------------------------------
# validate_classification_label — missing / wrong fields
# ---------------------------------------------------------------------------


def test_missing_classifications_raises():
    with pytest.raises(LLMParseError, match="classifications"):
        validate_classification_label({})


def test_empty_classifications_raises():
    with pytest.raises(LLMParseError, match="classifications"):
        validate_classification_label({"classifications": []})


def test_string_true_for_result_raises():
    bad = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "result": "true"}]}
    with pytest.raises(LLMParseError, match="result.*bool"):
        validate_classification_label(bad)


def test_string_confidence_raises():
    bad = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "confidence": "85"}]}
    with pytest.raises(LLMParseError, match="confidence.*number"):
        validate_classification_label(bad)


def test_confidence_above_100_raises():
    bad = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "confidence": 101}]}
    with pytest.raises(LLMParseError, match="0 and 100"):
        validate_classification_label(bad)


def test_confidence_negative_raises():
    bad = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "confidence": -1}]}
    with pytest.raises(LLMParseError, match="0 and 100"):
        validate_classification_label(bad)


def test_empty_explanation_raises():
    bad = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "explanation": ""}]}
    with pytest.raises(LLMParseError, match="explanation"):
        validate_classification_label(bad)


def test_missing_label_id_raises():
    bad = {"classifications": [{**_VALID_CLASSIFICATION_ENTRY, "labelId": ""}]}
    with pytest.raises(LLMParseError, match="labelId"):
        validate_classification_label(bad)
