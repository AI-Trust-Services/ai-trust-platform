"""Unit tests for control_templates.controls_for() and the tier filter."""
from __future__ import annotations

from app.control_templates import _CONTROL_TEMPLATES, _tier_allows, controls_for
from app.obligation_templates import obligations_for


# ---------------------------------------------------------------------------
# _tier_allows
# ---------------------------------------------------------------------------

def test_all_applies_to_every_tier():
    for tier in ("high", "limited", "minimal", "prohibited", "gpai-standard", "gpai-systemic"):
        assert _tier_allows("All", tier)


def test_high_risk_matches_high_only():
    assert _tier_allows("High-Risk", "high")
    assert not _tier_allows("High-Risk", "minimal")
    assert not _tier_allows("High-Risk", "prohibited")


def test_prohibited_matches_prohibited_only():
    assert _tier_allows("Prohibited", "prohibited")
    assert not _tier_allows("Prohibited", "high")


def test_limited_multi_token_matches_limited_and_high():
    assert _tier_allows("Limited-Risk; High-Risk", "limited")
    assert _tier_allows("Limited-Risk; High-Risk", "high")
    assert not _tier_allows("Limited-Risk; High-Risk", "minimal")


def test_gpai_systemic_is_superset_of_standard():
    # GPAI controls apply to both; GPAI-Systemic only to systemic.
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
# controls_for — EU high-risk (counts mirror the source library mapping)
# ---------------------------------------------------------------------------

def test_art9_high_risk_controls():
    ctls = controls_for("Art. 9", "high")
    assert len(ctls) == 5
    assert {c["slug"] for c in ctls} == {
        "AISEC-RM-002", "AISEC-RM-003", "AISEC-RM-004", "AISEC-RM-005", "AISEC-RM-006",
    }


def test_art10_high_risk_controls():
    assert len(controls_for("Art. 10", "high")) == 6


def test_art11_high_risk_controls():
    assert len(controls_for("Art. 11", "high")) == 5


def test_art12_high_risk_controls():
    assert len(controls_for("Art. 12", "high")) == 4


def test_art14_high_risk_controls():
    assert len(controls_for("Art. 14", "high")) == 4


def test_art15_high_risk_controls():
    # AC (2) + RB (3) + CS (6) = 11
    assert len(controls_for("Art. 15", "high")) == 11


def test_controls_have_required_fields():
    for c in controls_for("Art. 15", "high"):
        assert c["slug"]
        assert c["title"]
        assert c["description"]
        assert c["category"]
        assert c["risk_category"]


# ---------------------------------------------------------------------------
# controls_for — tier scoping
# ---------------------------------------------------------------------------

def test_prohibited_controls_only_for_prohibited_tier():
    assert len(controls_for("Art. 5", "prohibited")) == 8
    # A high-risk assessment must never receive prohibited controls, even if it
    # somehow carried an Art. 5 obligation.
    assert controls_for("Art. 5", "high") == []


def test_gpai_systemic_controls_excluded_from_standard():
    # Art. 55 safety framework is GPAI-Systemic — not for gpai-standard.
    assert controls_for("Art. 55", "gpai-systemic") == controls_for("Art. 55", "gpai-systemic")
    assert len(controls_for("Art. 55", "gpai-systemic")) == 1
    assert controls_for("Art. 55", "gpai-standard") == []


def test_gpai_standard_controls_present_for_both():
    assert len(controls_for("Art. 53", "gpai-standard")) == 2
    assert len(controls_for("Art. 53", "gpai-systemic")) == 2


def test_limited_controls():
    assert len(controls_for("Art. 50(1)", "limited")) == 1
    assert len(controls_for("Art. 50(2)", "limited")) == 1
    assert len(controls_for("Art. 50(4)", "limited")) == 1


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

def test_unknown_article_ref_returns_empty():
    assert controls_for("Art. 999", "high") == []


def test_returns_independent_lists():
    a = controls_for("Art. 9", "high")
    a.clear()
    assert len(controls_for("Art. 9", "high")) == 5


# ---------------------------------------------------------------------------
# Coverage: every EU obligation template article_ref has >=1 matching control
# at its own tier (the "100% coverage" goal).
# ---------------------------------------------------------------------------

def test_every_eu_obligation_has_controls_at_its_tier():
    tiers = ["prohibited", "gpai-systemic", "gpai-standard", "high", "limited", "minimal"]
    gaps = []
    for tier in tiers:
        for ob in obligations_for("FRM-EU-AI-ACT", tier):
            if not controls_for(ob["article_ref"], tier):
                gaps.append((tier, ob["article_ref"]))
    assert gaps == [], f"obligations without controls: {gaps}"


def test_every_nist_obligation_has_controls():
    for ob in obligations_for("FRM-NIST-AI-RMF", "high"):
        assert controls_for(ob["article_ref"], "high"), ob["article_ref"]


def test_every_iso_obligation_has_controls():
    for ob in obligations_for("FRM-ISO-42001", "high"):
        assert controls_for(ob["article_ref"], "high"), ob["article_ref"]


def test_slugs_unique_within_each_article():
    for ref, templates in _CONTROL_TEMPLATES.items():
        slugs = [t["slug"] for t in templates]
        assert len(slugs) == len(set(slugs)), f"duplicate slug in {ref}"
