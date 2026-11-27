"""Unit tests for questionnaire_gating.py.

Tests cover:
- evaluate_applies_when: all three operators (CONTAINS, IN, EQUALS) and both
  combinators (all / any).
- is_gated: questions with and without gates, recursive chain propagation,
  cycle guard (circular appliesWhen never causes RecursionError).
- get_all_gated_question_ids: returns the correct set for a given answers dict.
"""

import json

import pytest
from app.questionnaire_gating import (
    QUESTIONS_WITH_GATE,
    evaluate_applies_when,
    get_all_gated_question_ids,
    is_gated,
)

# ---------------------------------------------------------------------------
# evaluate_applies_when
# ---------------------------------------------------------------------------


class TestEvaluateAppliesWhen:
    """Tests for the low-level condition evaluator."""

    # --- CONTAINS ---

    def test_contains_match(self):
        node = {
            "all": [{"questionId": "Q1", "operator": "CONTAINS", "value": "OPTION_A"}]
        }
        assert evaluate_applies_when(node, {"Q1": json.dumps(["OPTION_A", "OPTION_B"])})

    def test_contains_no_match(self):
        node = {
            "all": [{"questionId": "Q1", "operator": "CONTAINS", "value": "OPTION_C"}]
        }
        assert not evaluate_applies_when(
            node, {"Q1": json.dumps(["OPTION_A", "OPTION_B"])}
        )

    def test_contains_empty_array(self):
        node = {
            "all": [{"questionId": "Q1", "operator": "CONTAINS", "value": "OPTION_A"}]
        }
        assert not evaluate_applies_when(node, {"Q1": "[]"})

    def test_contains_null_answer(self):
        node = {
            "all": [{"questionId": "Q1", "operator": "CONTAINS", "value": "OPTION_A"}]
        }
        assert not evaluate_applies_when(node, {"Q1": None})

    # --- IN ---

    def test_in_match(self):
        node = {
            "all": [
                {"questionId": "Q1", "operator": "IN", "values": ["YES", "PARTIALLY"]}
            ]
        }
        assert evaluate_applies_when(node, {"Q1": "YES"})

    def test_in_no_match(self):
        node = {
            "all": [
                {"questionId": "Q1", "operator": "IN", "values": ["YES", "PARTIALLY"]}
            ]
        }
        assert not evaluate_applies_when(node, {"Q1": "NO"})

    def test_in_null_answer(self):
        node = {"all": [{"questionId": "Q1", "operator": "IN", "values": ["YES"]}]}
        assert not evaluate_applies_when(node, {"Q1": None})

    # --- EQUALS ---

    def test_equals_match(self):
        node = {"all": [{"questionId": "Q1", "operator": "EQUALS", "value": "NO"}]}
        assert evaluate_applies_when(node, {"Q1": "NO"})

    def test_equals_no_match(self):
        node = {"all": [{"questionId": "Q1", "operator": "EQUALS", "value": "NO"}]}
        assert not evaluate_applies_when(node, {"Q1": "YES"})

    # --- all combinator (AND) ---

    def test_all_both_true(self):
        node = {
            "all": [
                {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
                {"questionId": "Q2", "operator": "EQUALS", "value": "NO"},
            ]
        }
        assert evaluate_applies_when(node, {"Q1": "YES", "Q2": "NO"})

    def test_all_one_false(self):
        node = {
            "all": [
                {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
                {"questionId": "Q2", "operator": "EQUALS", "value": "NO"},
            ]
        }
        assert not evaluate_applies_when(node, {"Q1": "YES", "Q2": "YES"})

    # --- any combinator (OR) ---

    def test_any_one_true(self):
        node = {
            "any": [
                {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
                {"questionId": "Q2", "operator": "EQUALS", "value": "YES"},
            ]
        }
        assert evaluate_applies_when(node, {"Q1": "NO", "Q2": "YES"})

    def test_any_both_false(self):
        node = {
            "any": [
                {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
                {"questionId": "Q2", "operator": "EQUALS", "value": "YES"},
            ]
        }
        assert not evaluate_applies_when(node, {"Q1": "NO", "Q2": "NO"})

    def test_any_both_true(self):
        node = {
            "any": [
                {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
                {"questionId": "Q2", "operator": "EQUALS", "value": "YES"},
            ]
        }
        assert evaluate_applies_when(node, {"Q1": "YES", "Q2": "YES"})

    def test_bare_leaf_at_top_level(self):
        # Defensive branch: a leaf node passed directly (no all/any wrapper).
        node = {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}
        assert evaluate_applies_when(node, {"Q1": "YES"})
        assert not evaluate_applies_when(node, {"Q1": "NO"})


# ---------------------------------------------------------------------------
# is_gated — using real questionnaire data
# ---------------------------------------------------------------------------


class TestIsGated:
    """Tests against the actual ai-questionnaire.json data."""

    def test_scope_question_never_gated(self):
        # Scope_1 has no appliesWhen — always unlocked.
        assert not is_gated("Scope_1", {})

    def test_prohibited_1_never_gated(self):
        # Prohibited_1 is the gate question itself — no appliesWhen.
        assert not is_gated("Prohibited_1", {})

    def test_high_risk_2_never_gated(self):
        # High_Risk_2 is the gate question itself — no appliesWhen.
        assert not is_gated("High_Risk_2", {})

    def test_prohibited_2_gated_when_no_answer(self):
        # Prohibited_2 requires Prohibited_1 to CONTAIN SENSITIVE_BIOMETRIC_CATEGORISATION.
        assert is_gated("Prohibited_2", {})

    def test_prohibited_2_gated_when_wrong_option(self):
        answers = {"Prohibited_1": json.dumps(["SOCIAL_SCORING"])}
        assert is_gated("Prohibited_2", answers)

    def test_prohibited_2_unlocked_when_correct_option(self):
        answers = {"Prohibited_1": json.dumps(["SENSITIVE_BIOMETRIC_CATEGORISATION"])}
        assert not is_gated("Prohibited_2", answers)

    def test_prohibited_2_unlocked_when_multiple_options_include_correct(self):
        answers = {
            "Prohibited_1": json.dumps(
                ["SOCIAL_SCORING", "SENSITIVE_BIOMETRIC_CATEGORISATION"]
            )
        }
        assert not is_gated("Prohibited_2", answers)

    def test_high_risk_3_gated_when_no_high_risk_2(self):
        # High_Risk_3 (BIOMETRICS area) requires High_Risk_2 to CONTAIN BIOMETRICS.
        assert is_gated("High_Risk_3", {})

    def test_high_risk_3_unlocked_when_biometrics_selected(self):
        answers = {"High_Risk_2": json.dumps(["BIOMETRICS"])}
        assert not is_gated("High_Risk_3", answers)

    def test_high_risk_3_still_gated_when_other_area_selected(self):
        answers = {"High_Risk_2": json.dumps(["LAW_ENFORCEMENT"])}
        assert is_gated("High_Risk_3", answers)

    # --- Recursive chain: High_Risk_32 → High_Risk_31 → High_Risk_3..30 ---

    def test_high_risk_32_gated_when_high_risk_31_gated(self):
        # High_Risk_32 requires High_Risk_31 == NO.
        # High_Risk_31 requires any of High_Risk_3..30 to be YES or PARTIALLY.
        # If High_Risk_2 has no answer, High_Risk_3..30 are all gated, so High_Risk_31
        # is also gated, so High_Risk_32's dependency (High_Risk_31) is treated as
        # None — condition fails → High_Risk_32 is gated.
        assert is_gated("High_Risk_32", {})

    def test_high_risk_32_gated_when_high_risk_31_yes(self):
        # High_Risk_31 is YES → High_Risk_32's condition (High_Risk_31 == NO) fails.
        answers = {
            "High_Risk_2": json.dumps(["BIOMETRICS"]),
            "High_Risk_3": "YES",
            "High_Risk_31": "YES",
        }
        assert is_gated("High_Risk_32", answers)

    def test_high_risk_32_unlocked_when_high_risk_31_no_and_chain_satisfied(self):
        # Full chain: High_Risk_2 has BIOMETRICS → High_Risk_3 unlocked → YES →
        # High_Risk_31 unlocked → NO → High_Risk_32 unlocked.
        answers = {
            "High_Risk_2": json.dumps(["BIOMETRICS"]),
            "High_Risk_3": "YES",
            "High_Risk_31": "NO",
        }
        assert not is_gated("High_Risk_32", answers)

    def test_cycle_guard_does_not_raise(self):
        # Inject a synthetic circular dependency: A gates B, B gates A.
        # is_gated must return without RecursionError and treat both as gated.
        import app.questionnaire_gating as qg

        original = dict(qg.QUESTIONS_WITH_GATE)
        qg.QUESTIONS_WITH_GATE["__CycleA__"] = {
            "all": [{"questionId": "__CycleB__", "operator": "EQUALS", "value": "YES"}]
        }
        qg.QUESTIONS_WITH_GATE["__CycleB__"] = {
            "all": [{"questionId": "__CycleA__", "operator": "EQUALS", "value": "YES"}]
        }
        try:
            # Must not raise RecursionError; both should be gated (fail-safe).
            assert is_gated("__CycleA__", {})
            assert is_gated("__CycleB__", {})
        finally:
            qg.QUESTIONS_WITH_GATE.clear()
            qg.QUESTIONS_WITH_GATE.update(original)


# ---------------------------------------------------------------------------
# get_all_gated_question_ids
# ---------------------------------------------------------------------------


class TestGetAllGatedQuestionIds:
    def test_all_gated_when_no_answers(self):
        # With no answers, all 47 gated questions should be locked.
        gated = get_all_gated_question_ids({})
        assert len(gated) == len(QUESTIONS_WITH_GATE)
        assert "Prohibited_2" in gated
        assert "High_Risk_3" in gated

    def test_memo_shared_across_calls(self):
        # Pass an explicit memo dict and verify it is populated after the call,
        # proving overlapping chains are not re-evaluated.
        import app.questionnaire_gating as qg

        memo: dict[str, bool] = {}
        answers = {"High_Risk_2": json.dumps(["BIOMETRICS"]), "High_Risk_3": "YES"}
        qg.get_all_gated_question_ids.__wrapped__ if hasattr(
            qg.get_all_gated_question_ids, "__wrapped__"
        ) else None
        # Call is_gated directly with a shared memo to confirm caching works.
        result1 = qg.is_gated("High_Risk_3", answers, _memo=memo)
        assert "High_Risk_3" in memo
        cached = memo["High_Risk_3"]
        result2 = qg.is_gated("High_Risk_3", answers, _memo=memo)
        assert result1 == result2 == cached  # second call hit the memo, same result

    def test_prohibited_dependents_unlocked_by_prohibited_1(self):
        answers = {"Prohibited_1": json.dumps(["SENSITIVE_BIOMETRIC_CATEGORISATION"])}
        gated = get_all_gated_question_ids(answers)
        # Prohibited_2 and Prohibited_3 require SENSITIVE_BIOMETRIC_CATEGORISATION → unlocked.
        assert "Prohibited_2" not in gated
        assert "Prohibited_3" not in gated
        # Prohibited_4 requires MANIPULATIVE_OR_DECEPTIVE_TECHNIQUES → still gated.
        assert "Prohibited_4" in gated

    def test_non_gated_questions_never_appear(self):
        gated = get_all_gated_question_ids({})
        # Questions without appliesWhen are never in the gated set.
        assert "Scope_1" not in gated
        assert "Prohibited_1" not in gated
        assert "High_Risk_2" not in gated
        assert "Role_1" not in gated
