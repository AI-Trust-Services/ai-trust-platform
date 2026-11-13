"""Unit tests for app/llm/validators.py."""

from __future__ import annotations

import pytest

from app.llm.parsing import LLMParseError
from app.llm.validators import (
    validate_answer_entries,
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


def test_non_string_question_type_raises():
    raw = {"results": [{**_VALID_RESULT, "questionType": []}]}
    with pytest.raises(LLMParseError, match="questionType"):
        validate_questionnaire_batch(raw)


def test_non_string_answer_strength_raises():
    raw = {
        "results": [
            {
                **_VALID_RESULT,
                "answer": [{"value": "YES", "answerStrength": [], "reason": None}],
            }
        ]
    }
    with pytest.raises(LLMParseError, match="answerStrength"):
        validate_questionnaire_batch(raw)


def test_non_string_source_type_raises():
    raw = {
        "results": [
            {
                **_VALID_RESULT,
                "references": [{**_VALID_REFERENCE, "sourceType": []}],
            }
        ]
    }
    with pytest.raises(LLMParseError, match="sourceType"):
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


def test_label_id_must_match_requested_label():
    with pytest.raises(LLMParseError, match="labelId.*'DEPLOYER'.*'HIGH_RISK'"):
        validate_classification_label(_VALID_CLASSIFICATION, "DEPLOYER")


def test_label_id_matching_requested_label_passes():
    validate_classification_label(_VALID_CLASSIFICATION, "HIGH_RISK")


def test_exactly_one_classification_entry_required():
    bad = {
        "classifications": [
            _VALID_CLASSIFICATION_ENTRY,
            {**_VALID_CLASSIFICATION_ENTRY, "labelId": "PROHIBITED"},
        ]
    }
    with pytest.raises(LLMParseError, match="exactly one entry"):
        validate_classification_label(bad)


def test_non_object_classification_entry_raises():
    with pytest.raises(LLMParseError, match="must be an object"):
        validate_classification_label({"classifications": ["HIGH_RISK"]})


# ---------------------------------------------------------------------------
# validate_questionnaire_batch — answer-semantics rules (no batch config)
# ---------------------------------------------------------------------------


def _result_with(answer: list[dict], **overrides) -> dict:
    return {"results": [{**_VALID_RESULT, "answer": answer, **overrides}]}


def test_predefined_with_two_answer_items_raises():
    raw = _result_with(
        [
            {"value": "YES", "answerStrength": "HIGH", "reason": None},
            {"value": "NO", "answerStrength": "HIGH", "reason": None},
        ]
    )
    with pytest.raises(LLMParseError, match="exactly one answer item"):
        validate_questionnaire_batch(raw)


def test_descriptive_with_two_answer_items_raises():
    raw = _result_with(
        [
            {"value": "Some description", "answerStrength": "HIGH", "reason": None},
            {
                "value": "Another description",
                "answerStrength": "MEDIUM",
                "reason": None,
            },
        ],
        questionType="DESCRIPTIVE",
    )
    with pytest.raises(LLMParseError, match="exactly one answer item"):
        validate_questionnaire_batch(raw)


def test_duplicate_answer_values_raise():
    raw = _result_with(
        [
            {"value": "A", "answerStrength": "HIGH", "reason": None},
            {"value": "A", "answerStrength": "HIGH", "reason": None},
        ],
        questionType="MULTISELECT",
    )
    with pytest.raises(LLMParseError, match="duplicate answer values"):
        validate_questionnaire_batch(raw)


@pytest.mark.parametrize("outcome", ["NOT_ENOUGH_INFORMATION", "CONFLICT"])
def test_outcome_with_strength_raises(outcome):
    raw = _result_with([{"value": outcome, "answerStrength": "LOW", "reason": None}])
    with pytest.raises(LLMParseError, match=f"{outcome} must have answerStrength null"):
        validate_questionnaire_batch(raw)


@pytest.mark.parametrize("outcome", ["NOT_ENOUGH_INFORMATION", "CONFLICT"])
def test_outcome_must_be_only_item(outcome):
    raw = _result_with(
        [
            {"value": outcome, "answerStrength": None, "reason": None},
            {"value": "A", "answerStrength": "HIGH", "reason": None},
        ],
        questionType="MULTISELECT",
    )
    with pytest.raises(LLMParseError, match="must be the only answer item"):
        validate_questionnaire_batch(raw)


def test_substantive_answer_without_strength_raises():
    raw = _result_with([{"value": "YES", "answerStrength": None, "reason": None}])
    with pytest.raises(LLMParseError, match="needs answerStrength"):
        validate_questionnaire_batch(raw)


def test_not_applicable_with_low_strength_raises():
    raw = _result_with(
        [{"value": "NOT_APPLICABLE", "answerStrength": "LOW", "reason": "x"}]
    )
    with pytest.raises(LLMParseError, match="must not have answerStrength LOW"):
        validate_questionnaire_batch(raw)


def test_not_applicable_is_exclusive_in_multiselect():
    raw = _result_with(
        [
            {"value": "NOT_APPLICABLE", "answerStrength": "HIGH", "reason": None},
            {"value": "A", "answerStrength": "HIGH", "reason": None},
        ],
        questionType="MULTISELECT",
    )
    with pytest.raises(LLMParseError, match="mutually exclusive"):
        validate_questionnaire_batch(raw)


def test_duplicate_question_id_raises():
    raw = {"results": [_VALID_RESULT, _VALID_RESULT]}
    with pytest.raises(LLMParseError, match="duplicate answer for 'Scope_1'"):
        validate_questionnaire_batch(raw)


# ---------------------------------------------------------------------------
# validate_questionnaire_batch — against the batch config
# ---------------------------------------------------------------------------

_BATCH = {
    "questions": [
        {
            "id": "Scope_1",
            "type": "PREDEFINED",
            "allowedAnswers": ["YES", "NO", "NOT_APPLICABLE"],
        },
        {
            "id": "Scope_2",
            "type": "MULTISELECT",
            "allowedAnswers": [
                {"value": "Defense", "code": "a"},
                {"value": "Research", "code": "b"},
            ],
        },
        {"id": "Desc_1", "type": "DESCRIPTIVE"},
    ]
}


def _batch_results(*items: dict) -> dict:
    return {"results": list(items)}


def _item(qid: str, qtype: str, answer: list[dict]) -> dict:
    return {**_VALID_RESULT, "questionId": qid, "questionType": qtype, "answer": answer}


_OK_SCOPE_1 = _item("Scope_1", "PREDEFINED", [_VALID_ANSWER])
_OK_SCOPE_2 = _item(
    "Scope_2",
    "MULTISELECT",
    [{"value": "Defense", "answerStrength": "MEDIUM", "reason": None}],
)
_OK_DESC_1 = _item(
    "Desc_1",
    "DESCRIPTIVE",
    [{"value": "Free text.", "answerStrength": "HIGH", "reason": None}],
)


def test_full_batch_passes():
    validate_questionnaire_batch(
        _batch_results(_OK_SCOPE_1, _OK_SCOPE_2, _OK_DESC_1), _BATCH
    )


def test_missing_batch_question_raises():
    with pytest.raises(LLMParseError, match=r"missing an answer.*Desc_1"):
        validate_questionnaire_batch(_batch_results(_OK_SCOPE_1, _OK_SCOPE_2), _BATCH)


def test_question_from_another_batch_raises():
    stray = _item("Other_9", "PREDEFINED", [_VALID_ANSWER])
    with pytest.raises(
        LLMParseError, match="'Other_9' is not a question of this batch"
    ):
        validate_questionnaire_batch(
            _batch_results(_OK_SCOPE_1, _OK_SCOPE_2, _OK_DESC_1, stray), _BATCH
        )


def test_question_type_must_match_config():
    wrong = _item("Scope_1", "DESCRIPTIVE", [_VALID_ANSWER])
    with pytest.raises(LLMParseError, match="'Scope_1' is PREDEFINED"):
        validate_questionnaire_batch(
            _batch_results(wrong, _OK_SCOPE_2, _OK_DESC_1), _BATCH
        )


def test_predefined_value_outside_options_raises():
    bad = _item(
        "Scope_1",
        "PREDEFINED",
        [{"value": "maybe", "answerStrength": "HIGH", "reason": None}],
    )
    with pytest.raises(LLMParseError, match=r"\['maybe'\] are not allowed"):
        validate_questionnaire_batch(
            _batch_results(bad, _OK_SCOPE_2, _OK_DESC_1), _BATCH
        )


def test_multiselect_value_outside_options_raises():
    bad = _item(
        "Scope_2",
        "MULTISELECT",
        [{"value": "Space", "answerStrength": "HIGH", "reason": None}],
    )
    with pytest.raises(LLMParseError, match=r"\['Space'\] are not allowed"):
        validate_questionnaire_batch(
            _batch_results(_OK_SCOPE_1, bad, _OK_DESC_1), _BATCH
        )


def test_system_outcomes_allowed_even_when_not_configured():
    nei = _item(
        "Scope_2",
        "MULTISELECT",
        [{"value": "NOT_ENOUGH_INFORMATION", "answerStrength": None, "reason": "x"}],
    )
    validate_questionnaire_batch(_batch_results(_OK_SCOPE_1, nei, _OK_DESC_1), _BATCH)


def test_descriptive_value_is_free_text():
    validate_questionnaire_batch(
        _batch_results(_OK_SCOPE_1, _OK_SCOPE_2, _OK_DESC_1), _BATCH
    )


def test_all_violations_reported_in_one_error():
    bad_1 = _item(
        "Scope_1",
        "PREDEFINED",
        [{"value": "maybe", "answerStrength": None, "reason": None}],
    )
    with pytest.raises(LLMParseError) as exc:
        validate_questionnaire_batch(_batch_results(bad_1), _BATCH)
    msg = str(exc.value)
    assert "needs answerStrength" in msg
    assert "not allowed" in msg
    assert "missing an answer" in msg


def test_violation_report_is_capped():
    items = [{**_VALID_RESULT, "questionId": f"Q{i}", "question": 1} for i in range(30)]
    with pytest.raises(LLMParseError, match=r"and \d+ more violation"):
        validate_questionnaire_batch({"results": items})


# ---------------------------------------------------------------------------
# validate_answer_entries (pre-flight for stored results used by classification)
# ---------------------------------------------------------------------------


def _make_entry(q_id: str, answers: list[dict]) -> dict:
    return {"questionId": q_id, "answer": answers}


def test_entries_valid_data_passes():
    validate_answer_entries(
        [
            _make_entry("Q1", [{"value": "YES", "answerStrength": "HIGH"}]),
            _make_entry(
                "Q2", [{"value": "NOT_ENOUGH_INFORMATION", "answerStrength": None}]
            ),
        ]
    )


def test_entries_missing_question_id_raises():
    with pytest.raises(LLMParseError, match="missing 'questionId'"):
        validate_answer_entries(
            [{"answer": [{"value": "YES", "answerStrength": "HIGH"}]}]
        )


def test_entries_empty_answer_array_raises():
    with pytest.raises(LLMParseError, match="empty or missing 'answer' array"):
        validate_answer_entries([_make_entry("Q1", [])])


def test_entries_invalid_answer_strength_raises():
    with pytest.raises(LLMParseError, match="answerStrength"):
        validate_answer_entries(
            [_make_entry("Q1", [{"value": "YES", "answerStrength": "VERY_HIGH"}])]
        )


def test_entries_not_applicable_with_regular_value_raises():
    with pytest.raises(LLMParseError, match="NOT_APPLICABLE combined with regular"):
        validate_answer_entries(
            [
                _make_entry(
                    "Q1",
                    [
                        {"value": "NOT_APPLICABLE", "answerStrength": "HIGH"},
                        {"value": "OPTION_A", "answerStrength": "HIGH"},
                    ],
                )
            ]
        )


def test_entries_not_applicable_alone_passes():
    validate_answer_entries(
        [_make_entry("Q1", [{"value": "NOT_APPLICABLE", "answerStrength": "HIGH"}])]
    )


def test_entries_conflict_with_null_strength_passes():
    validate_answer_entries(
        [_make_entry("Q1", [{"value": "CONFLICT", "answerStrength": None}])]
    )


def test_entries_multiple_regular_values_passes():
    validate_answer_entries(
        [
            _make_entry(
                "Q1",
                [
                    {"value": "OPTION_A", "answerStrength": "HIGH"},
                    {"value": "OPTION_B", "answerStrength": "MEDIUM"},
                ],
            )
        ]
    )
