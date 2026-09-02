"""Unit tests for the CO-approval completeness gate (questionnaire_required).

These exercise the pure gap-computation branches that the e2e workflow tests don't
all reach: the full_manual and manual-questionnaire skips, and the dual-storage rule
(a business key counts as answered if EITHER its column OR its answers entry is set).
"""
from __future__ import annotations

from types import SimpleNamespace

from app.questionnaire_required import (
    REQUIRED_AI_TECHNICAL,
    missing_business_keys,
    missing_for_approval,
    missing_technical_keys,
)

# Complete answer sets mirroring the e2e helpers.
_BUSINESS_ANSWERS = {
    "submission_type": "Initial Submission",
    "use_case_owner": "Jane Doe",
    "use_case_type": "Internal development for own organisational use",
    "technologies": "LLM, Python",
    "use_case_status": "New AI use case",
    "planned_modifications": "N/A",
    "entity_role": "Provider",
    "exception_category": "None of the above",
    "sector_legislation": "None of the above",
}
_TECHNICAL_ANSWERS = {k: f"answer for {k}" for k in REQUIRED_AI_TECHNICAL}


def _row(mode="ai", *, department=None, use_case=None, answers=None):
    return SimpleNamespace(
        registration_mode=mode,
        department=department,
        use_case=use_case,
        questionnaire_answers=answers,
    )


def _complete_ai_row():
    return _row(
        "ai",
        department="Engineering",
        use_case="A detailed description.",
        answers={**_BUSINESS_ANSWERS, "technical": _TECHNICAL_ANSWERS},
    )


# ── business gaps ──────────────────────────────────────────────────────────────

def test_missing_business_all_when_blank():
    missing = missing_business_keys(_row("ai", answers=None))
    # Every required business key is reported, including the two column-backed ones.
    assert set(missing) == {
        "submission_type", "use_case_owner", "use_case_type", "department",
        "technologies", "use_case_status", "use_case", "planned_modifications",
        "entity_role", "exception_category", "sector_legislation",
    }


def test_missing_business_none_when_complete():
    row = _row("ai", department="Eng", use_case="desc", answers=_BUSINESS_ANSWERS)
    assert missing_business_keys(row) == []


def test_column_backed_key_satisfied_by_column():
    # department/use_case live on the row; setting the column clears the gap.
    row = _row("ai", department="Eng", use_case="desc", answers=_BUSINESS_ANSWERS)
    assert "department" not in missing_business_keys(row)
    assert "use_case" not in missing_business_keys(row)


def test_column_backed_key_satisfied_by_answers_fallback():
    # Dual-storage: if the column is blank but the answers entry is set, it still counts.
    row = _row("ai", department=None, use_case=None,
               answers={**_BUSINESS_ANSWERS, "department": "Eng", "use_case": "desc"})
    assert "department" not in missing_business_keys(row)
    assert "use_case" not in missing_business_keys(row)


def test_whitespace_only_answer_is_a_gap():
    answers = {**_BUSINESS_ANSWERS, "use_case_owner": "   "}
    row = _row("ai", department="Eng", use_case="desc", answers=answers)
    assert "use_case_owner" in missing_business_keys(row)


# ── technical gaps ───────────────────────────────────────────────────────────────

def test_technical_gaps_only_in_ai_mode():
    # Manual-questionnaire technical is boolean/number flags → never a gap.
    assert missing_technical_keys(_row("manual_questionnaire", answers=None)) == []
    assert missing_technical_keys(_row("full_manual", answers=None)) == []


def test_technical_all_missing_in_ai_mode_when_blank():
    assert set(missing_technical_keys(_row("ai", answers=None))) == set(REQUIRED_AI_TECHNICAL)


def test_technical_none_missing_when_complete():
    row = _row("ai", answers={"technical": _TECHNICAL_ANSWERS})
    assert missing_technical_keys(row) == []


# ── approval aggregate ───────────────────────────────────────────────────────────

def test_full_manual_skips_the_gate_entirely():
    # full_manual has no questionnaire sections even with blank answers.
    assert missing_for_approval(_row("full_manual", answers=None)) == []


def test_manual_questionnaire_only_gated_on_business():
    # Blank manual-questionnaire system → only business keys missing, no technical.
    missing = missing_for_approval(_row("manual_questionnaire", answers=None))
    assert missing and all(k not in REQUIRED_AI_TECHNICAL for k in missing)


def test_complete_ai_system_has_no_gaps():
    assert missing_for_approval(_complete_ai_row()) == []


def test_incomplete_ai_system_reports_business_and_technical():
    missing = missing_for_approval(_row("ai", answers=None))
    assert "use_case" in missing            # business column key
    assert "data_and_inputs" in missing     # technical key
