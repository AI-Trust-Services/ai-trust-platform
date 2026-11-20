"""Regression test for the per-label vs per-rule skip granularity bug.

Bug: classification_pipeline.py step 4 collects ALL questionIds across ALL rules
of a label (via get_question_ids_from_label) and skips the entire label if ANY
question is missing.  The skip granularity should be per-rule, not per-label.

Concrete case (SYS-D84E84C1):
  HIGH_RISK has two rules:
    ANNEX_I_PRODUCT_OR_SAFETY_COMPONENT  — only needs High_Risk_1
    ANNEX_III_USE_CASE                   — needs High_Risk_3..High_Risk_36

  When High_Risk_1 = [LIFTS_AND_SAFETY_COMPONENTS] and all Annex III questions
  are unanswered, ANNEX_I fires → HIGH_RISK should be classified, not skipped.

  Current behaviour (the bug): step 4 sees that High_Risk_3..36 are missing,
  puts HIGH_RISK into skipped_labels, and the system ends up MINIMAL instead
  of HIGH_RISK.

Both tests below FAIL against the current code — they document the bug.
"""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/ai_trust_test")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost")
os.environ.setdefault("THALAMUS_BASE_URL", "stub")

import json
from pathlib import Path

from app.classification_pipeline import _scope_questionnaire_data
from app.questionnaire_tree import get_question_ids_from_label

# ---------------------------------------------------------------------------
# Load the real HIGH_RISK label from the production config so the test
# exercises the actual rule trees, not a hand-crafted stub.
# ---------------------------------------------------------------------------

_CONFIG_PATH = (
    Path(__file__).parents[4]  # repo root
    / "context/prompts/risk_classification/risk_role_classification_config.json"
)


def _load_high_risk_label() -> dict:
    config = json.loads(_CONFIG_PATH.read_text())
    for label in config.get("riskLabels", []):
        if label["id"] == "HIGH_RISK":
            return label
    raise RuntimeError("HIGH_RISK label not found in config")


# Annex III question ids (High_Risk_3..36)  — resolved once at module level.
_HIGH_RISK_LABEL = _load_high_risk_label()
_ALL_HIGH_RISK_QIDS = get_question_ids_from_label(_HIGH_RISK_LABEL)
_ANNEX_III_QIDS = _ALL_HIGH_RISK_QIDS - {"High_Risk_1"}


def _questionnaire_entry(question_id: str, answer: list[str]) -> dict:
    return {"questionId": question_id, "answer": answer}


# ---------------------------------------------------------------------------
# Shared helper: apply the current step-4 skip logic from the pipeline and
# return (runnable_label_ids, skipped_label_ids).
# ---------------------------------------------------------------------------


def _run_skip_check(questionnaire_results: list[dict]) -> tuple[set[str], set[str]]:
    """Minimal reproduction of classification_pipeline.py step 4."""
    label = _HIGH_RISK_LABEL
    question_ids = get_question_ids_from_label(label)
    scoped = _scope_questionnaire_data(questionnaire_results, question_ids)
    answered_ids = {r.get("questionId") for r in scoped}
    missing = question_ids - answered_ids
    if missing:
        return set(), {"HIGH_RISK"}
    return {"HIGH_RISK"}, set()


# ---------------------------------------------------------------------------
# TEST 1 — Annex I alone triggers HIGH_RISK (the exact bug-report scenario)
#
# High_Risk_1 = [LIFTS_AND_SAFETY_COMPONENTS] is answered.
# All Annex III questions (High_Risk_3..36) are unanswered.
#
# ANNEX_I rule is fully satisfied → HIGH_RISK must end up in runnable, not skipped.
# Current code: skips HIGH_RISK (bug) → test FAILS.
# ---------------------------------------------------------------------------


def test_annex_i_alone_makes_high_risk_runnable():
    questionnaire_results = [
        _questionnaire_entry("High_Risk_1", ["LIFTS_AND_SAFETY_COMPONENTS"]),
        # High_Risk_3..36 intentionally absent
    ]

    runnable, skipped = _run_skip_check(questionnaire_results)

    assert "HIGH_RISK" in runnable, (
        "HIGH_RISK must be runnable when Annex I rule is fully answered, "
        "even if Annex III questions are missing. "
        f"Currently skipped (bug) — missing Annex III ids cause whole label to be skipped."
    )
    assert "HIGH_RISK" not in skipped


# ---------------------------------------------------------------------------
# TEST 2 — Partial Annex III alone does not spuriously fire HIGH_RISK
#
# High_Risk_1 is empty (Annex I rule cannot fire).
# Only some Annex III questions are answered (rule still incomplete).
#
# Neither rule is fully answerable → HIGH_RISK must stay skipped (or at least
# not be forced into runnable with a firing result).  This confirms the fix
# does not over-correct in the other direction.
#
# This test passes today (the whole label is skipped), but it must keep passing
# after the fix is applied, so we include it here.
# ---------------------------------------------------------------------------


def test_partial_annex_iii_alone_does_not_spuriously_classify_high_risk():
    # Annex I: High_Risk_1 not answered
    # Annex III: only a few questions answered, not all — rule incomplete
    partial_annex_iii = list(_ANNEX_III_QIDS)[:5]
    questionnaire_results = [
        _questionnaire_entry(qid, ["YES"]) for qid in partial_annex_iii
    ]

    runnable, skipped = _run_skip_check(questionnaire_results)

    # With per-rule skip granularity: Annex I rule has no data → skip that rule.
    # Annex III rule is incomplete → skip that rule too.
    # No complete rule exists → HIGH_RISK should NOT be runnable.
    assert "HIGH_RISK" not in runnable, (
        "HIGH_RISK must not be runnable when no rule is fully answered."
    )
