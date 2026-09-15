"""Unit tests for obligation_templates.obligations_for() and ids.new_id()."""
from __future__ import annotations

import re

import pytest

from app.ids import new_id
from app.obligation_templates import obligations_for


# ---------------------------------------------------------------------------
# new_id
# ---------------------------------------------------------------------------

def test_new_id_has_correct_prefix():
    assert new_id("ASS").startswith("ASS-")


def test_new_id_correct_length():
    # "ASS-" (4) + 8 hex chars = 12
    assert len(new_id("ASS")) == 12


def test_new_id_hex_suffix():
    suffix = new_id("OBL").split("-")[1]
    assert re.fullmatch(r"[0-9A-F]{8}", suffix)


def test_new_id_unique():
    ids = {new_id("CTL") for _ in range(100)}
    assert len(ids) == 100


def test_new_id_different_prefixes():
    assert new_id("ASS").startswith("ASS-")
    assert new_id("OBL").startswith("OBL-")
    assert new_id("CTL").startswith("CTL-")
    assert new_id("EVD").startswith("EVD-")


# ---------------------------------------------------------------------------
# obligations_for — EU AI Act High / Limited (CSV catalogue, role-aware)
# ---------------------------------------------------------------------------

def test_eu_high_risk_provider_count():
    # Provider is the default org_role.
    obs = obligations_for("FRM-EU-AI-ACT", "high")
    assert len(obs) == 15


def test_eu_high_risk_deployer_count():
    obs = obligations_for("FRM-EU-AI-ACT", "high", "deployer")
    assert len(obs) == 10


def test_eu_high_risk_has_required_fields():
    for ob in obligations_for("FRM-EU-AI-ACT", "high"):
        assert ob["title"]
        assert ob["article_ref"]
        assert ob["cluster_id"]
        # Clusters carry no description of their own — descriptive text lives on
        # the requirement-level controls, not the obligation.
        assert "description" not in ob


def test_eu_high_risk_provider_article_refs():
    refs = {ob["article_ref"] for ob in obligations_for("FRM-EU-AI-ACT", "high")}
    assert "Art. 9 EU AI Act" in refs
    assert "Art. 14 EU AI Act" in refs
    assert "Art. 73 EU AI Act" in refs


def test_eu_high_risk_deployer_article_refs():
    refs = {ob["article_ref"] for ob in obligations_for("FRM-EU-AI-ACT", "high", "deployer")}
    assert "Art. 26 EU AI Act" in refs
    assert "Art. 27 EU AI Act" in refs
    # Provider-only clusters must not leak into the deployer set.
    assert "Art. 9 EU AI Act" not in refs


def test_eu_high_importer_is_empty():
    assert obligations_for("FRM-EU-AI-ACT", "high", "importer") == []


def test_eu_high_distributor_is_empty():
    assert obligations_for("FRM-EU-AI-ACT", "high", "distributor") == []


def test_eu_limited_provider_count():
    obs = obligations_for("FRM-EU-AI-ACT", "limited")
    assert len(obs) == 2


def test_eu_limited_deployer_count():
    obs = obligations_for("FRM-EU-AI-ACT", "limited", "deployer")
    assert len(obs) == 1


def test_eu_limited_provider_article_refs():
    refs = {ob["article_ref"] for ob in obligations_for("FRM-EU-AI-ACT", "limited")}
    assert "Art. 50 EU AI Act" in refs


def test_eu_limited_provider_includes_all_risk_cluster():
    # P-REG carries a "Risk = All" requirement, so it applies at limited risk too.
    ids = {ob["cluster_id"] for ob in obligations_for("FRM-EU-AI-ACT", "limited")}
    assert "P-REG" in ids


def test_eu_limited_importer_is_empty():
    assert obligations_for("FRM-EU-AI-ACT", "limited", "importer") == []


# ---------------------------------------------------------------------------
# obligations_for — NIST AI RMF
# ---------------------------------------------------------------------------

def test_nist_count():
    assert len(obligations_for("FRM-NIST-AI-RMF", "high")) == 6


def test_nist_tier_independent():
    for tier in ("high", "limited", "minimal", "prohibited", "gpai-standard", "gpai-systemic"):
        assert len(obligations_for("FRM-NIST-AI-RMF", tier)) == 6


def test_nist_has_govern():
    titles = [ob["title"] for ob in obligations_for("FRM-NIST-AI-RMF", "high")]
    assert any("GOVERN" in t for t in titles)


# ---------------------------------------------------------------------------
# obligations_for — ISO/IEC 42001
# ---------------------------------------------------------------------------

def test_iso_count():
    assert len(obligations_for("FRM-ISO-42001", "high")) == 5


def test_iso_tier_independent():
    for tier in ("high", "limited", "minimal", "prohibited"):
        assert len(obligations_for("FRM-ISO-42001", tier)) == 5


def test_iso_has_clause_4():
    refs = {ob["article_ref"] for ob in obligations_for("FRM-ISO-42001", "high")}
    assert "Clause 4" in refs


# ---------------------------------------------------------------------------
# obligations_for — unknown framework / tier
# ---------------------------------------------------------------------------

def test_unknown_framework_returns_empty():
    assert obligations_for("FRM-UNKNOWN", "high") == []


def test_unknown_eu_tier_returns_empty():
    assert obligations_for("FRM-EU-AI-ACT", "unknown-tier") == []


def test_returns_independent_lists():
    a = obligations_for("FRM-EU-AI-ACT", "high")
    b = obligations_for("FRM-EU-AI-ACT", "high")
    a.clear()
    assert len(b) == 15
