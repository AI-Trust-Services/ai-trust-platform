"""Unit tests for questionnaire_required — validates that ai-questionnaire.json
is loaded correctly and the expected constants are populated."""

from __future__ import annotations

from app.questionnaire_required import VALID_QUESTION_KEYS, QUESTION_LABEL


def test_valid_question_keys_non_empty():
    assert len(VALID_QUESTION_KEYS) > 50, (
        "Expected ~100 question keys from ai-questionnaire.json"
    )


def test_valid_question_keys_contains_known_ids():
    for key in ("Scope_1", "Prohibited_1", "High_Risk_1", "Transparency_1"):
        assert key in VALID_QUESTION_KEYS, f"Expected {key} in VALID_QUESTION_KEYS"


def test_question_label_non_empty():
    assert len(QUESTION_LABEL) > 50


def test_question_label_matches_keys():
    assert set(QUESTION_LABEL.keys()) == set(VALID_QUESTION_KEYS)


def test_question_label_scope_1():
    label = QUESTION_LABEL.get("Scope_1", "")
    assert label, "Scope_1 should have a non-empty label"
    assert isinstance(label, str)
