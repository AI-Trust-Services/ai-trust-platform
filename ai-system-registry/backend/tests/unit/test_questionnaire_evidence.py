"""Unit tests for the questionnaire pipeline's evidence block (no DB, no network).

Issue #383: `ai_systems` carries NOT NULL columns with schema defaults that no UI
ever collects (`system_type='application'`, `autonomy_level='decision_support'`, …).
The system prompt declares this block authoritative evidence and grades anything
stated in it HIGH, so a default leaking through makes the LLM answer confidently
from a fact nobody asserted. `_system_evidence` is therefore a strict allowlist of
the fields a user can see and change in the UI.
"""

from __future__ import annotations

from datetime import date

from ai_trust_persistence.models.ai_system import AISystem

from app.questionnaire_pipeline import _system_evidence

# Columns that must never appear, with the value a real row would carry. The ORM
# `default=` is applied at INSERT, not in `__init__`, so a bare AISystem(name=...)
# leaves these as None and the exclusion assertions would pass vacuously — every
# one of them is set explicitly here so the test actually proves the filtering.
_FORBIDDEN = {
    "system_type": "application",
    "autonomy_level": "decision_support",
    "org_role": "provider",
    "version": "1.0.0",
    "provider": "Acme Corp",
    "org_name": "Acme Corp",
    "description": "a description nobody can edit in the UI",
    "department": "Retail Banking",
    "use_case": "Loan scoring",
    "people_affected": "Applicants",
    "decision_context": "Credit decisions",
    "deployment_country": "DE",
    "is_gpai": False,
    "is_chatbot": False,
    "generates_synthetic_content": False,
    "tier": "pending",
}


def _row(**overrides) -> AISystem:
    row = AISystem(
        id="SYS-TEST0001",
        name="Loan Scoring Bot",
        intended_purpose="Scores retail loan applications.",
        lifecycle="development",
        planned_rollout_date=date(2026, 6, 1),
        git_repo_url="https://github.com/acme/loan-bot",
        **_FORBIDDEN,
    )
    for key, value in overrides.items():
        setattr(row, key, value)
    return row


def test_allowlisted_fields_are_present():
    block = _system_evidence(_row())
    assert block.startswith("Registration Data — AI System Inventory")
    assert "name: Loan Scoring Bot" in block
    assert "intended_purpose: Scores retail loan applications." in block
    assert "lifecycle: development" in block
    assert "planned_rollout_date: 2026-06-01" in block
    assert "git_repo_url: https://github.com/acme/loan-bot" in block


def test_defaulted_and_derived_columns_are_excluded():
    """The columns behind issue #383 — schema defaults no UI collects, plus the
    classifier's own `tier` output."""
    block = _system_evidence(_row())
    for key, value in _FORBIDDEN.items():
        assert f"{key}:" not in block, f"{key} must not be presented as evidence"
        assert f"{key}: {value}" not in block
    # The exact two lines the LLM cited back as HIGH-confidence evidence in #383.
    assert "system_type: application" not in block
    assert "autonomy_level: decision_support" not in block


def test_boolean_flags_are_excluded_not_merely_filtered():
    """`False != ""` is True, so the empty-value filter never dropped the risk
    booleans — "nobody told us" was rendered to the model as a documented "no"."""
    block = _system_evidence(_row())
    assert "is_gpai" not in block
    assert "is_chatbot" not in block
    assert "generates_synthetic_content" not in block
    assert ": False" not in block


def test_questionnaire_answers_are_not_fed_back():
    """The prompt states "Questionnaire answers are not factual evidence for other
    questions"; feeding a previous run back would make a retry self-confirming."""
    block = _system_evidence(_row(questionnaire_answers={"Scope_1": "YES"}))
    assert "questionnaire_answers" not in block
    assert "Scope_1" not in block


def test_empty_and_null_allowlisted_fields_are_omitted():
    """An unset optional field must be absent rather than rendered as an empty
    statement of fact."""
    block = _system_evidence(
        _row(intended_purpose="", planned_rollout_date=None, git_repo_url=None)
    )
    assert "intended_purpose" not in block
    assert "planned_rollout_date" not in block
    assert "git_repo_url" not in block
    assert "name: Loan Scoring Bot" in block
