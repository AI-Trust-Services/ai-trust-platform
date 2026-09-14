"""Unit tests for control_templates.controls_for() and the tier/role filters."""
from __future__ import annotations

from app.control_templates import (
    _CONTROL_TEMPLATES,
    _REQUIREMENT_ARTICLES,
    _role_allows,
    _tier_allows,
    cluster_articles,
    controls_for,
)
from app.obligation_templates import obligations_for
from app.schemas.control import VALID_CONTROL_CATEGORIES


# ---------------------------------------------------------------------------
# _tier_allows
# ---------------------------------------------------------------------------

def test_all_applies_to_every_tier():
    for tier in ("high", "limited", "minimal", "prohibited", "gpai-standard", "gpai-systemic"):
        assert _tier_allows("All", tier)


def test_high_risk_matches_high_only():
    # Both the CSV token ("High") and the retained-library token ("High-Risk").
    assert _tier_allows("High-Risk", "high")
    assert _tier_allows("High", "high")
    assert not _tier_allows("High-Risk", "minimal")
    assert not _tier_allows("High", "prohibited")


def test_limited_tokens():
    assert _tier_allows("Limited", "limited")
    assert _tier_allows("Limited-Risk", "limited")
    assert not _tier_allows("Limited", "high")


def test_prohibited_matches_prohibited_only():
    assert _tier_allows("Prohibited", "prohibited")
    assert not _tier_allows("Prohibited", "high")


def test_gpai_systemic_is_superset_of_standard():
    assert _tier_allows("GPAI", "gpai-standard")
    assert _tier_allows("GPAI", "gpai-systemic")
    assert _tier_allows("GPAI-Systemic", "gpai-systemic")
    assert not _tier_allows("GPAI-Systemic", "gpai-standard")


def test_minimal_allows_only_all():
    assert not _tier_allows("High-Risk", "minimal")
    assert _tier_allows("All", "minimal")


def test_unknown_tier_allows_only_all():
    assert _tier_allows("All", "nonsense-tier")
    assert not _tier_allows("High-Risk", "nonsense-tier")


# ---------------------------------------------------------------------------
# _role_allows
# ---------------------------------------------------------------------------

def test_role_none_applies_to_any_org_role():
    # Retained sets carry no role — they apply everywhere.
    assert _role_allows(None, "provider")
    assert _role_allows(None, "deployer")
    assert _role_allows("", "importer")
    assert _role_allows("all", "distributor")


def test_role_matches_only_its_own_org_role():
    assert _role_allows("provider", "provider")
    assert not _role_allows("provider", "deployer")
    assert _role_allows("deployer", "deployer")
    assert not _role_allows("deployer", "provider")
    # Unsupported org roles never match a role-scoped template.
    assert not _role_allows("provider", "importer")
    assert not _role_allows("deployer", "distributor")


# ---------------------------------------------------------------------------
# controls_for — EU High-Risk clusters (counts from the CSV catalogue)
# ---------------------------------------------------------------------------

def test_provider_high_risk_management_controls():
    ctls = controls_for("P-RM", "high", "provider")
    assert len(ctls) == 7
    assert {c["control_ref"] for c in ctls} == {
        "P-RM-01", "P-RM-02", "P-RM-03", "P-RM-04", "P-RM-05", "P-RM-06", "P-RM-07",
    }


def test_provider_high_data_governance_controls():
    assert len(controls_for("P-DG", "high", "provider")) == 9


def test_provider_high_qms_controls():
    # P-QMS splits usage / documentation / regular-update into three Requirements.
    assert len(controls_for("P-QMS", "high", "provider")) == 3


def test_provider_high_registration_controls():
    assert len(controls_for("P-REG", "high", "provider")) == 3


def test_provider_clusters_absent_for_deployer():
    # A provider cluster yields nothing when the system is a deployer.
    assert controls_for("P-RM", "high", "deployer") == []
    assert controls_for("P-DG", "high", "deployer") == []


def test_deployer_high_clusters():
    assert len(controls_for("D-OMI", "high", "deployer")) == 5
    assert len(controls_for("D-FRIA", "high", "deployer")) == 2
    # A deployer cluster yields nothing for a provider system.
    assert controls_for("D-OMI", "high", "provider") == []


def test_all_risk_cluster_applies_at_limited_tier():
    # P-REG carries a "Risk = All" requirement, so at least one control survives
    # at the limited tier too.
    assert len(controls_for("P-REG", "limited", "provider")) == 1


def test_limited_transparency_controls():
    assert len(controls_for("P-LIM", "limited", "provider")) == 2
    assert len(controls_for("D-LIM", "limited", "deployer")) == 4


def test_controls_have_required_fields():
    # Both shapes: CSV templates use `risk`, retained sets use `risk_category`.
    for c in controls_for("P-RM", "high", "provider"):
        assert c["title"]
        assert c["description"]
        assert c["category"]
        assert c.get("risk") or c.get("risk_category")
        assert c["control_ref"]
    for c in controls_for("Art. 5", "prohibited"):
        assert c["title"]
        assert c["description"]
        assert c["category"]
        assert c.get("risk") or c.get("risk_category")
        assert c["slug"]


# ---------------------------------------------------------------------------
# Per-requirement articles + cluster aggregation
# ---------------------------------------------------------------------------

def test_every_eu_control_ref_has_an_article():
    # Every explicit Requirement ID (EU CSV set) is mapped; retained sets (slug-based)
    # carry no control_ref and are intentionally absent.
    csv_refs = {
        c["control_ref"]
        for templates in _CONTROL_TEMPLATES.values()
        for c in templates
        if c.get("control_ref")
    }
    assert csv_refs, "expected some explicit control_ref templates"
    assert csv_refs <= set(_REQUIREMENT_ARTICLES), csv_refs - set(_REQUIREMENT_ARTICLES)


def test_controls_for_attaches_article():
    ctls = controls_for("P-RM", "high", "provider")
    assert ctls[0]["article"] == _REQUIREMENT_ARTICLES["P-RM-01"]


def test_cluster_articles_aggregates_distinct_top_level():
    # P-RM requirements reference Art. 9, Art. 11 and Art. 72 -> distinct, num-sorted.
    assert cluster_articles("P-RM", "high", "provider") == "Art. 9, Art. 11, Art. 72 EU AI Act"
    assert cluster_articles("P-DG", "high", "provider") == "Art. 10 EU AI Act"


def test_cluster_articles_empty_for_retained_and_wrong_role():
    # Retained sets carry no per-requirement article.
    assert cluster_articles("Art. 5", "prohibited") == ""
    # No provider controls survive for a deployer cluster.
    assert cluster_articles("P-RM", "high", "deployer") == ""


# ---------------------------------------------------------------------------
# controls_for — retained sets (tier scoping unchanged)
# ---------------------------------------------------------------------------

def test_prohibited_controls_only_for_prohibited_tier():
    assert len(controls_for("Art. 5", "prohibited")) == 8
    assert controls_for("Art. 5", "high") == []


def test_gpai_systemic_controls_excluded_from_standard():
    assert len(controls_for("Art. 55", "gpai-systemic")) == 1
    assert controls_for("Art. 55", "gpai-standard") == []


def test_gpai_standard_controls_present_for_both():
    assert len(controls_for("Art. 53", "gpai-standard")) == 2
    assert len(controls_for("Art. 53", "gpai-systemic")) == 2


def test_minimal_voluntary_controls():
    assert len(controls_for("Art. 69", "minimal")) == 1
    assert len(controls_for("Art. 69(a) (voluntary)", "minimal")) == 1


def test_nist_controls_tier_independent():
    for tier in ("high", "minimal", "prohibited"):
        assert len(controls_for("GOVERN", tier)) == 1


def test_iso_controls_tier_independent():
    for tier in ("high", "minimal", "prohibited"):
        assert len(controls_for("Clause 4", tier)) == 1


# ---------------------------------------------------------------------------
# controls_for — unknown refs / independence
# ---------------------------------------------------------------------------

def test_unknown_cluster_returns_empty():
    assert controls_for("P-DOES-NOT-EXIST", "high", "provider") == []
    assert controls_for("Art. 999", "high") == []


def test_returns_independent_lists():
    a = controls_for("P-RM", "high", "provider")
    a.clear()
    assert len(controls_for("P-RM", "high", "provider")) == 7


# ---------------------------------------------------------------------------
# Coverage: every EU obligation cluster has >=1 matching control at its own
# (tier, role) — the "100% coverage" goal.
# ---------------------------------------------------------------------------

def test_every_eu_obligation_has_controls_at_its_tier_and_role():
    gaps = []
    for tier in ("prohibited", "gpai-systemic", "gpai-standard", "high", "limited", "minimal"):
        for role in ("provider", "deployer"):
            for ob in obligations_for("FRM-EU-AI-ACT", tier, role):
                if not controls_for(ob["cluster_id"], tier, role):
                    gaps.append((tier, role, ob["cluster_id"]))
    assert gaps == [], f"obligation clusters without controls: {gaps}"


def test_every_nist_obligation_has_controls():
    for ob in obligations_for("FRM-NIST-AI-RMF", "high"):
        assert controls_for(ob["cluster_id"], "high"), ob["cluster_id"]


def test_every_iso_obligation_has_controls():
    for ob in obligations_for("FRM-ISO-42001", "high"):
        assert controls_for(ob["cluster_id"], "high"), ob["cluster_id"]


def test_control_refs_unique_within_each_cluster():
    for cid, templates in _CONTROL_TEMPLATES.items():
        refs = [t.get("control_ref") or t["slug"] for t in templates]
        assert len(refs) == len(set(refs)), f"duplicate control_ref/slug in {cid}"


def test_all_categories_are_valid():
    # Generated controls must use categories a human can later edit without a
    # ControlUpdate validation error (schemas.control.VALID_CONTROL_CATEGORIES).
    for cid, templates in _CONTROL_TEMPLATES.items():
        for t in templates:
            assert t["category"] in VALID_CONTROL_CATEGORIES, f"{cid}: {t['category']}"
