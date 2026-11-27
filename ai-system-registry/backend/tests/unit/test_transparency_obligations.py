"""Unit tests for Art. 50 transparency obligation generation.

Verifies that obligations_for() / requirements_for() emit the P-LIM/D-LIM
Art. 50 clusters when transparency=True, regardless of risk tier.
Pure logic, no I/O, no mocks.
"""

from __future__ import annotations

import os

import pytest

# ai_trust_persistence.__init__ imports database.py which reads DATABASE_URL.
# Set a dummy value before the import so the module loads without a real DB.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://u:p@localhost/ai_trust_test"
)

from ai_trust_persistence.governance.obligation_templates import obligations_for
from ai_trust_persistence.governance.requirement_templates import requirements_for

FW = "FRM-EU-AI-ACT"
LIM_CLUSTERS = {"P-LIM", "D-LIM"}


def _cluster_ids(obligations: list[dict]) -> set[str]:
    return {o["cluster_id"] for o in obligations}


# ---------------------------------------------------------------------------
# obligations_for — transparency flag
# ---------------------------------------------------------------------------


def test_minimal_provider_no_transparency_yields_empty():
    assert obligations_for(FW, "minimal", "provider") == []


def test_minimal_provider_with_transparency_yields_p_lim():
    result = obligations_for(FW, "minimal", "provider", transparency=True)
    ids = _cluster_ids(result)
    assert "P-LIM" in ids, f"expected P-LIM, got {ids}"
    assert "D-LIM" not in ids


def test_minimal_deployer_with_transparency_yields_d_lim():
    result = obligations_for(FW, "minimal", "deployer", transparency=True)
    ids = _cluster_ids(result)
    assert "D-LIM" in ids
    assert "P-LIM" not in ids


def test_minimal_both_with_transparency_yields_both_lim_clusters():
    result = obligations_for(FW, "minimal", "both", transparency=True)
    ids = _cluster_ids(result)
    assert LIM_CLUSTERS <= ids, f"expected both P-LIM and D-LIM, got {ids}"


def test_prohibited_with_transparency_yields_no_lim():
    result = obligations_for(FW, "prohibited", "provider", transparency=True)
    ids = _cluster_ids(result)
    assert LIM_CLUSTERS.isdisjoint(ids), (
        f"prohibited must never get LIM clusters, got {ids}"
    )


def test_high_provider_no_transparency_does_not_yield_lim():
    """High-risk without transparency: standard high set only, no Art. 50."""
    result = obligations_for(FW, "high", "provider")
    ids = _cluster_ids(result)
    assert LIM_CLUSTERS.isdisjoint(ids)


def test_high_provider_with_transparency_yields_high_plus_lim():
    """High-risk + transparency: full high set AND P-LIM stacked on top."""
    base = _cluster_ids(obligations_for(FW, "high", "provider"))
    stacked = _cluster_ids(obligations_for(FW, "high", "provider", transparency=True))
    assert "P-LIM" in stacked
    # all high clusters still present
    assert base <= stacked, "high clusters must not be dropped when transparency=True"


def test_gpai_standard_with_transparency_yields_lim():
    result = obligations_for(FW, "gpai-standard", "provider", transparency=True)
    ids = _cluster_ids(result)
    assert "P-LIM" in ids


# ---------------------------------------------------------------------------
# requirements_for — P-LIM/D-LIM produce non-empty results
# ---------------------------------------------------------------------------


def test_p_lim_requirements_non_empty_with_limited_tier():
    reqs = requirements_for("P-LIM", "limited", "provider")
    assert reqs, "P-LIM should have requirements at limited tier"


def test_d_lim_requirements_non_empty_with_limited_tier():
    reqs = requirements_for("D-LIM", "limited", "deployer")
    assert reqs, "D-LIM should have requirements at limited tier"


def test_p_lim_requirements_empty_at_minimal_tier():
    """requirements_for("P-LIM", "minimal") is still empty — generation must use 'limited' as probe tier."""
    assert requirements_for("P-LIM", "minimal", "provider") == []
