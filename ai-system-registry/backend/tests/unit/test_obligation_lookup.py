"""Unit tests for the RCE-summary obligation lookup (obligations_for_tier).

Pure tier → obligation-set logic with org_role filtering, mirroring the
classifier tests: public interface only, no I/O, no mocks.
"""
from __future__ import annotations

from app.obligation_lookup import obligations_for_tier


def _roles(obligations: list[dict]) -> set[str]:
    return {o["roles"] for o in obligations}


def test_provider_role_excludes_deployer_only_obligations():
    """The default provider view returns provider + shared duties, never deployer-only ones."""
    result = obligations_for_tier("high")  # org_role defaults to "provider"
    assert result, "high tier should have obligations"
    assert _roles(result) <= {"provider", "both"}
    assert "deployer" not in _roles(result)


def test_deployer_role_excludes_provider_only_obligations():
    """The deployer view returns deployer + shared duties, never provider-only ones."""
    result = obligations_for_tier("high", org_role="deployer")
    assert result
    assert _roles(result) <= {"deployer", "both"}
    assert "provider" not in _roles(result)


def test_both_role_returns_every_obligation_for_the_tier():
    """org_role='both' returns the full tier set — the union of provider and deployer views."""
    everything = obligations_for_tier("high", org_role="both")
    provider = obligations_for_tier("high", org_role="provider")
    deployer = obligations_for_tier("high", org_role="deployer")
    assert len(everything) == len({o["article_ref"] for o in everything})  # no accidental dupes
    assert len(everything) == len(provider) + len([o for o in deployer if o["roles"] == "deployer"])


def test_unknown_tier_returns_empty_list():
    assert obligations_for_tier("no-such-tier") == []


def test_gpai_systemic_is_a_superset_of_gpai_standard():
    """Systemic GPAI carries every standard-GPAI duty plus the additional systemic-risk ones."""
    standard = {o["article_ref"] for o in obligations_for_tier("gpai-standard", org_role="both")}
    systemic = {o["article_ref"] for o in obligations_for_tier("gpai-systemic", org_role="both")}
    assert standard < systemic
