"""Regression tests for the hierarchy solver's handling of *skipped* labels.

Bug: ``docs/bugs/hierarchy-solver-skipped-label-override-noop.md``.

A classification pipeline-2 run drops any label it had no questionnaire data
for into ``skipped_labels`` (absent from ``classifications``). A user override
that targets such a label — either an ANSWER override that should trigger the
label's rule, or a direct LABEL override — must still be able to make that
label the resolved risk winner.

These are pure-function tests: ``hierarchy_solver.solve()`` takes a plain dict
plus ``LabelOverrides`` and returns a ``ResolveResponse`` with no I/O, so no
Postgres/MinIO is needed. The solver still loads the real
``risk_classification/risk_role_classification_config.json`` at call time, so
these cases exercise the production rule trees and operators exactly.

NOTE: test_answer_override_revives_skipped_prohibited_social_scoring previously
used an incomplete answer set (only Prohibited_8, missing Prohibited_1) that
did not satisfy the SOCIAL_SCORING rule's ``all`` condition. Fixed to match the
real config rule tree.
"""

from __future__ import annotations

import os

# The solver imports app.classifier -> ai_trust_persistence, which reads
# DATABASE_URL at import time. The solver never opens a connection (it is a pure
# function), so any well-formed async URL satisfies the import. Mirrors the
# setdefault pattern in tests/e2e/conftest.py.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://u:p@localhost/ai_trust_test"
)
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost")

from app import hierarchy_solver
from app.schemas.hierarchy_solver import LabelOverrides

# ---------------------------------------------------------------------------
# TEST 1 — the exact bug-report case: Prohibited_8 = YES revives a skipped
# PROHIBITED label via the SOCIAL_SCORING rule.
#
# Config rule (risk_role_classification_config.json):
#   SOCIAL_SCORING -> {"questionId": "Prohibited_8", "operator": "IN",
#                      "values": ["YES", "PARTIALLY"]}
# so "YES" is a matching answer value.
# ---------------------------------------------------------------------------


def test_answer_override_revives_skipped_prohibited_social_scoring():
    pipeline_result = {
        "questionnaire_run_key": "questionnaire-results/SYS-TESTTEST/ai-questionnaire/2026-01-01T00-00-00Z.json",
        "config_id": "risk_role_classification_config",
        "config_version": "1.0.0",
        "prompt_id": "risk_role_classification",
        # PROHIBITED is SKIPPED — absent from classifications, present in skipped_labels.
        "classifications": [
            {
                "labelId": "HIGH_RISK",
                "result": False,
                "confidence": 20.0,
                "explanation": "",
            },
            {
                "labelId": "TRANSPARENCY",
                "result": False,
                "confidence": 20.0,
                "explanation": "",
            },
            {
                "labelId": "PROVIDER",
                "result": True,
                "confidence": 90.0,
                "explanation": "",
            },
        ],
        "skipped_labels": [
            {
                "labelId": "PROHIBITED",
                "reason": "insufficient data",
                "missingQuestionIds": ["Prohibited_8"],
            },
        ],
    }
    overrides = LabelOverrides(
        answers={"Prohibited_1": ["SOCIAL_SCORING"], "Prohibited_8": ["YES"]}
    )

    resp = hierarchy_solver.solve(pipeline_result, overrides, None)

    assert resp.risk.label_id == "PROHIBITED"
    assert resp.risk.result is True


# ---------------------------------------------------------------------------
# TEST 2 — same skipped-label re-eval scenario, but constructed so the rule
# evaluated uses ONLY an operator eval_tree currently supports (CONTAINS),
# isolating the classification_map-seeding + answer-override re-eval path from
# the separate IN-operator crash.
#
# HIGH_RISK is the only risk label whose *first* rule uses a supported operator:
#   ANNEX_I_PRODUCT_OR_SAFETY_COMPONENT ->
#     {"any": [{"questionId": "High_Risk_1", "operator": "CONTAINS", "value": "MACHINERY"}, ...]}
#
# classification_map is seeded only from `classifications` + `skipped_labels`,
# so by listing only HIGH_RISK (skipped) and a role label, the answer-override
# re-eval loop never touches a PROHIBITED/TRANSPARENCY IN-rule and cannot trip
# the IN-operator bug — this test fails (or passes) purely on the skipped-label
# revival logic, not on the operator gap.
# ---------------------------------------------------------------------------


def test_answer_override_revives_skipped_high_risk_supported_operator():
    pipeline_result = {
        "questionnaire_run_key": "questionnaire-results/SYS-TESTTEST/ai-questionnaire/2026-01-01T00-00-00Z.json",
        "config_id": "risk_role_classification_config",
        "config_version": "1.0.0",
        "prompt_id": "risk_role_classification",
        # Only HIGH_RISK (skipped) and a role label enter classification_map,
        # so the re-eval loop never evaluates an IN-operator rule.
        "classifications": [
            {
                "labelId": "PROVIDER",
                "result": True,
                "confidence": 90.0,
                "explanation": "",
            },
        ],
        "skipped_labels": [
            {
                "labelId": "HIGH_RISK",
                "reason": "insufficient data",
                "missingQuestionIds": ["High_Risk_1"],
            },
        ],
    }
    overrides = LabelOverrides(answers={"High_Risk_1": ["MACHINERY"]})

    resp = hierarchy_solver.solve(pipeline_result, overrides, None)

    assert resp.risk.label_id == "HIGH_RISK"
    assert resp.risk.result is True


# ---------------------------------------------------------------------------
# A1: label_to_tier + org_role_from_roles
# ---------------------------------------------------------------------------


def test_label_to_tier_all_cases():
    assert hierarchy_solver.label_to_tier("PROHIBITED") == "prohibited"
    assert hierarchy_solver.label_to_tier("HIGH_RISK") == "high"
    assert hierarchy_solver.label_to_tier("MINIMAL") == "minimal"


def test_label_to_tier_unknown_raises():
    import pytest

    with pytest.raises(KeyError):
        hierarchy_solver.label_to_tier("GPAI")


def test_org_role_both():
    from app.schemas.hierarchy_solver import ResolvedLabel

    roles = [
        ResolvedLabel(
            label_id="PROVIDER",
            result=True,
            source="pipeline",
            confidence=90.0,
            confidence_band="High",
            explanation=None,
        ),
        ResolvedLabel(
            label_id="DEPLOYER",
            result=True,
            source="pipeline",
            confidence=80.0,
            confidence_band="High",
            explanation=None,
        ),
    ]
    assert hierarchy_solver.org_role_from_roles(roles) == "both"


def test_org_role_provider_only():
    from app.schemas.hierarchy_solver import ResolvedLabel

    roles = [
        ResolvedLabel(
            label_id="PROVIDER",
            result=True,
            source="pipeline",
            confidence=90.0,
            confidence_band="High",
            explanation=None,
        ),
        ResolvedLabel(
            label_id="DEPLOYER",
            result=False,
            source="pipeline",
            confidence=70.0,
            confidence_band="High",
            explanation=None,
        ),
    ]
    assert hierarchy_solver.org_role_from_roles(roles) == "provider"


def test_org_role_deployer_only():
    from app.schemas.hierarchy_solver import ResolvedLabel

    roles = [
        ResolvedLabel(
            label_id="DEPLOYER",
            result=True,
            source="pipeline",
            confidence=85.0,
            confidence_band="High",
            explanation=None,
        ),
    ]
    assert hierarchy_solver.org_role_from_roles(roles) == "deployer"


def test_org_role_none():
    from app.schemas.hierarchy_solver import ResolvedLabel

    roles = [
        ResolvedLabel(
            label_id="PROVIDER",
            result=False,
            source="pipeline",
            confidence=50.0,
            confidence_band="Low",
            explanation=None,
        ),
    ]
    assert hierarchy_solver.org_role_from_roles(roles) is None


def test_org_role_empty():
    assert hierarchy_solver.org_role_from_roles([]) is None


# ---------------------------------------------------------------------------
# Transparency is orthogonal — not a risk winner, separate field on response
# ---------------------------------------------------------------------------


def test_transparency_separate_from_risk_winner():
    pipeline_result = {
        "questionnaire_run_key": "questionnaire-results/SYS-TESTTEST/ai-questionnaire/2026-01-01T00-00-00Z.json",
        "config_id": "risk_role_classification_config",
        "config_version": "1.0.0",
        "prompt_id": "risk_role_classification",
        "classifications": [
            {
                "labelId": "HIGH_RISK",
                "result": True,
                "confidence": 85.0,
                "explanation": "",
            },
            {
                "labelId": "TRANSPARENCY",
                "result": True,
                "confidence": 75.0,
                "explanation": "",
            },
            {
                "labelId": "MINIMAL",
                "result": False,
                "confidence": 20.0,
                "explanation": "",
            },
        ],
        "skipped_labels": [],
    }

    resp = hierarchy_solver.solve(pipeline_result, None, None)

    assert resp.risk.label_id == "HIGH_RISK"
    assert resp.risk.result is True
    assert resp.transparency is not None
    assert resp.transparency.label_id == "TRANSPARENCY"
    assert resp.transparency.result is True
