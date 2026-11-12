"""Unit tests for classification_pipeline.py.

No DB, no MinIO, no LLM — pure Python logic.
"""

from __future__ import annotations

import pytest

from app.classification_pipeline import (
    _collect_question_ids,
    _label_question_ids,
    _scope_questionnaire_data,
    _validate_questionnaire_data,
)
from app.llm.parsing import LLMParseError


# ---------------------------------------------------------------------------
# _collect_question_ids / _label_question_ids
# ---------------------------------------------------------------------------


def test_collect_question_ids_atomic():
    node = {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}
    assert _collect_question_ids(node) == {"Q1"}


def test_collect_question_ids_nested_all_any():
    node = {
        "all": [
            {"questionId": "Q1", "operator": "IN", "values": ["YES", "PARTIALLY"]},
            {
                "any": [
                    {"questionId": "Q2", "operator": "EQUALS", "value": "NO"},
                    {"questionId": "Q3", "operator": "EQUALS", "value": "NO"},
                ]
            },
        ]
    }
    assert _collect_question_ids(node) == {"Q1", "Q2", "Q3"}


def test_collect_question_ids_list():
    nodes = [
        {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
        {"questionId": "Q2", "operator": "EQUALS", "value": "NO"},
    ]
    assert _collect_question_ids(nodes) == {"Q1", "Q2"}


def test_label_question_ids_multiple_rules():
    label = {
        "id": "DEPLOYER",
        "activate": True,
        "rules": [
            {"id": "RULE_A", "when": {"questionId": "Role_3", "operator": "EQUALS", "value": "YES"}},
            {"id": "RULE_B", "when": {"questionId": "Role_4", "operator": "EQUALS", "value": "YES"}},
        ],
    }
    assert _label_question_ids(label) == {"Role_3", "Role_4"}


def test_label_question_ids_empty_rules():
    label = {"id": "DISTRIBUTOR", "activate": False, "rules": []}
    assert _label_question_ids(label) == set()


# ---------------------------------------------------------------------------
# _scope_questionnaire_data
# ---------------------------------------------------------------------------


def test_scope_questionnaire_data_filters_correctly():
    results = [
        {"questionId": "Q1", "answer": [{"value": "YES", "answerStrength": "HIGH"}]},
        {"questionId": "Q2", "answer": [{"value": "NO", "answerStrength": "HIGH"}]},
        {"questionId": "Q3", "answer": [{"value": "YES", "answerStrength": "MEDIUM"}]},
    ]
    scoped = _scope_questionnaire_data(results, {"Q1", "Q3"})
    assert len(scoped) == 2
    assert {r["questionId"] for r in scoped} == {"Q1", "Q3"}


def test_scope_questionnaire_data_no_match_returns_empty():
    results = [{"questionId": "Q1", "answer": [{"value": "YES", "answerStrength": "HIGH"}]}]
    assert _scope_questionnaire_data(results, {"Q99"}) == []


def test_scope_questionnaire_data_empty_input():
    assert _scope_questionnaire_data([], {"Q1"}) == []


# ---------------------------------------------------------------------------
# _validate_questionnaire_data
# ---------------------------------------------------------------------------


def _make_result(q_id: str, answers: list[dict]) -> dict:
    return {"questionId": q_id, "answer": answers}


def test_validate_valid_data_passes():
    data = [
        _make_result("Q1", [{"value": "YES", "answerStrength": "HIGH"}]),
        _make_result("Q2", [{"value": "NOT_ENOUGH_INFORMATION", "answerStrength": None}]),
    ]
    _validate_questionnaire_data(data)  # must not raise


def test_validate_missing_question_id_raises():
    data = [{"answer": [{"value": "YES", "answerStrength": "HIGH"}]}]
    with pytest.raises(LLMParseError, match="missing 'questionId'"):
        _validate_questionnaire_data(data)


def test_validate_empty_answer_array_raises():
    data = [_make_result("Q1", [])]
    with pytest.raises(LLMParseError, match="empty or missing 'answer' array"):
        _validate_questionnaire_data(data)


def test_validate_invalid_answer_strength_raises():
    data = [_make_result("Q1", [{"value": "YES", "answerStrength": "VERY_HIGH"}])]
    with pytest.raises(LLMParseError, match="invalid answerStrength"):
        _validate_questionnaire_data(data)


def test_validate_not_applicable_with_regular_value_raises():
    data = [
        _make_result(
            "Q1",
            [
                {"value": "NOT_APPLICABLE", "answerStrength": "HIGH"},
                {"value": "OPTION_A", "answerStrength": "HIGH"},
            ],
        )
    ]
    with pytest.raises(LLMParseError, match="NOT_APPLICABLE combined with regular answer"):
        _validate_questionnaire_data(data)


def test_validate_not_applicable_alone_passes():
    data = [_make_result("Q1", [{"value": "NOT_APPLICABLE", "answerStrength": "HIGH"}])]
    _validate_questionnaire_data(data)  # must not raise


def test_validate_conflict_with_null_strength_passes():
    data = [_make_result("Q1", [{"value": "CONFLICT", "answerStrength": None}])]
    _validate_questionnaire_data(data)  # must not raise


def test_validate_multiple_regular_values_passes():
    data = [
        _make_result(
            "Q1",
            [
                {"value": "OPTION_A", "answerStrength": "HIGH"},
                {"value": "OPTION_B", "answerStrength": "MEDIUM"},
            ],
        )
    ]
    _validate_questionnaire_data(data)  # must not raise
