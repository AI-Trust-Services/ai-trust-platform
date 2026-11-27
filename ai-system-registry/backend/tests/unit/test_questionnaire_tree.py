"""Unit tests for questionnaire_tree.py.

No DB, no LLM, no I/O.
"""

from __future__ import annotations

import pytest
from app.questionnaire_tree import (
    collect_question_ids,
    eval_label,
    eval_tree,
    get_question_ids_from_label,
)

# ---------------------------------------------------------------------------
# collect_question_ids
# ---------------------------------------------------------------------------


def test_collect_question_ids_atom():
    node = {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}
    assert collect_question_ids(node) == {"Q1"}


def test_collect_question_ids_nested():
    node = {
        "all": [
            {"questionId": "Q1", "operator": "IN", "values": ["YES"]},
            {
                "any": [
                    {"questionId": "Q2", "operator": "EQUALS", "value": "NO"},
                    {"questionId": "Q3", "operator": "EQUALS", "value": "NO"},
                ]
            },
        ]
    }
    assert collect_question_ids(node) == {"Q1", "Q2", "Q3"}


def test_collect_question_ids_list():
    nodes = [
        {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
        {"questionId": "Q2", "operator": "EQUALS", "value": "NO"},
    ]
    assert collect_question_ids(nodes) == {"Q1", "Q2"}


def test_get_question_ids_from_label_multiple_rules():
    label = {
        "id": "HIGH_RISK",
        "rules": [
            {"when": {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}},
            {
                "when": {
                    "questionId": "Q2",
                    "operator": "CONTAINS",
                    "value": "MACHINERY",
                }
            },
        ],
    }
    assert get_question_ids_from_label(label) == {"Q1", "Q2"}


# ---------------------------------------------------------------------------
# eval_tree — operators
# ---------------------------------------------------------------------------


def test_eval_tree_equals_match():
    when = {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}
    assert eval_tree(when, {"Q1": ["YES"]}) is True


def test_eval_tree_equals_no_match():
    when = {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}
    assert eval_tree(when, {"Q1": ["NO"]}) is False


def test_eval_tree_contains_match():
    when = {"questionId": "Q1", "operator": "CONTAINS", "value": "MACHINERY"}
    assert eval_tree(when, {"Q1": ["MACHINERY", "TRANSPORT"]}) is True


def test_eval_tree_contains_no_match():
    when = {"questionId": "Q1", "operator": "CONTAINS", "value": "MACHINERY"}
    assert eval_tree(when, {"Q1": ["TRANSPORT"]}) is False


def test_eval_tree_unknown_operator_raises():
    when = {"questionId": "Q1", "operator": "STARTSWITH", "value": "Y"}
    with pytest.raises(ValueError, match="Unknown operator"):
        eval_tree(when, {"Q1": ["YES"]})


def test_eval_tree_not_contains_match():
    """Value absent from answers → true."""
    when = {"questionId": "Q1", "operator": "NOT_CONTAINS", "value": "MACHINERY"}
    assert eval_tree(when, {"Q1": ["TRANSPORT"]}) is True


def test_eval_tree_not_contains_no_match():
    """Value present in answers → false."""
    when = {"questionId": "Q1", "operator": "NOT_CONTAINS", "value": "MACHINERY"}
    assert eval_tree(when, {"Q1": ["MACHINERY", "TRANSPORT"]}) is False


def test_eval_tree_not_contains_empty_eligible():
    """No eligible answers → value is absent → true."""
    when = {"questionId": "Q1", "operator": "NOT_CONTAINS", "value": "MACHINERY"}
    assert eval_tree(when, {"Q1": []}) is True


def test_eval_tree_not_contains_missing_question():
    """Unknown question ID → empty eligible → true."""
    when = {"questionId": "MISSING", "operator": "NOT_CONTAINS", "value": "MACHINERY"}
    assert eval_tree(when, {}) is True


def test_eval_tree_not_contains_special_answers_filtered():
    """Special-only answers are filtered out; value is then absent → true."""
    when = {"questionId": "Q1", "operator": "NOT_CONTAINS", "value": "MACHINERY"}
    assert eval_tree(when, {"Q1": ["NOT_ENOUGH_INFORMATION", "CONFLICT"]}) is True


def test_eval_tree_not_contains_special_mixed_with_target_value():
    """Special answers filtered; the target value still present among eligibles → false."""
    when = {"questionId": "Q1", "operator": "NOT_CONTAINS", "value": "MACHINERY"}
    assert eval_tree(when, {"Q1": ["NOT_ENOUGH_INFORMATION", "MACHINERY"]}) is False


# ---------------------------------------------------------------------------
# eval_tree — special answer filtering
# ---------------------------------------------------------------------------


def test_eval_tree_special_answer_filtered():
    """A question answered only with special values → atom is false."""
    when = {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}
    for special in ("NOT_ENOUGH_INFORMATION", "CONFLICT", "NOT_APPLICABLE"):
        assert eval_tree(when, {"Q1": [special]}) is False


def test_eval_tree_special_mixed_with_eligible():
    """Special values are stripped but eligible values still count."""
    when = {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}
    assert eval_tree(when, {"Q1": ["NOT_ENOUGH_INFORMATION", "YES"]}) is True


def test_eval_tree_missing_question_id_is_false():
    """No entry in the map → treated as no eligible answers → false."""
    when = {"questionId": "UNKNOWN", "operator": "EQUALS", "value": "YES"}
    assert eval_tree(when, {}) is False


# ---------------------------------------------------------------------------
# eval_tree — groups
# ---------------------------------------------------------------------------


def test_eval_tree_all_true():
    when = {
        "all": [
            {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
            {"questionId": "Q2", "operator": "EQUALS", "value": "YES"},
        ]
    }
    assert eval_tree(when, {"Q1": ["YES"], "Q2": ["YES"]}) is True


def test_eval_tree_all_one_false():
    when = {
        "all": [
            {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
            {"questionId": "Q2", "operator": "EQUALS", "value": "YES"},
        ]
    }
    assert eval_tree(when, {"Q1": ["YES"], "Q2": ["NO"]}) is False


def test_eval_tree_any_one_true():
    when = {
        "any": [
            {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
            {"questionId": "Q2", "operator": "EQUALS", "value": "YES"},
        ]
    }
    assert eval_tree(when, {"Q1": ["NO"], "Q2": ["YES"]}) is True


def test_eval_tree_any_all_false():
    when = {
        "any": [
            {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
            {"questionId": "Q2", "operator": "EQUALS", "value": "YES"},
        ]
    }
    assert eval_tree(when, {"Q1": ["NO"], "Q2": ["NO"]}) is False


def test_eval_tree_empty_all_is_false():
    assert eval_tree({"all": []}, {}) is False


def test_eval_tree_empty_any_is_false():
    assert eval_tree({"any": []}, {}) is False


# ---------------------------------------------------------------------------
# eval_label
# ---------------------------------------------------------------------------


def test_eval_label_one_rule_true():
    label = {
        "id": "HIGH_RISK",
        "rules": [{"when": {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}}],
    }
    assert eval_label(label, {"Q1": ["YES"]}) is True


def test_eval_label_no_rules_is_false():
    assert eval_label({"id": "HIGH_RISK", "rules": []}, {}) is False


def test_eval_label_multiple_rules_or_semantics():
    """Label is true when any rule matches."""
    label = {
        "id": "HIGH_RISK",
        "rules": [
            {"when": {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}},
            {"when": {"questionId": "Q2", "operator": "EQUALS", "value": "YES"}},
        ],
    }
    assert eval_label(label, {"Q1": ["NO"], "Q2": ["YES"]}) is True
    assert eval_label(label, {"Q1": ["NO"], "Q2": ["NO"]}) is False
