"""Tests for the EU AI Act waterfall classifier."""
from __future__ import annotations

import pytest
from app.classifier import classify, _GPAI_SYSTEMIC_FLOPS_THRESHOLD
from app.schemas import AISystemCreate


def _base() -> dict:
    """Minimal valid payload — all flags off, results in minimal tier."""
    return {"name": "Test System"}


def test_minimal_risk():
    result = classify(AISystemCreate(**_base()))
    assert result.tier == "minimal"
    assert result.obligations == []
    assert result.annex_iii_area is None


# --- Art. 5 prohibited ---

@pytest.mark.parametrize("flag", [
    "subliminal_manipulation",
    "exploits_vulnerability",
    "social_scoring_public",
    "real_time_biometric_public",
    "emotion_recognition_workplace",
    "untargeted_facial_scraping",
    "predictive_policing",
    "biometric_categorisation_sensitive",
])
def test_prohibited_any_art5_flag(flag):
    result = classify(AISystemCreate(**{**_base(), flag: True}))
    assert result.tier == "prohibited"
    assert "Art. 5" in result.basis


def test_prohibited_takes_priority_over_gpai():
    result = classify(AISystemCreate(**{
        **_base(),
        "subliminal_manipulation": True,
        "is_gpai": True,
        "training_compute_flops": _GPAI_SYSTEMIC_FLOPS_THRESHOLD,
    }))
    assert result.tier == "prohibited"


def test_prohibited_takes_priority_over_high_risk():
    result = classify(AISystemCreate(**{
        **_base(),
        "subliminal_manipulation": True,
        "is_biometric_identification": True,
    }))
    assert result.tier == "prohibited"


# --- GPAI ---

def test_gpai_systemic_at_threshold():
    result = classify(AISystemCreate(**{
        **_base(),
        "is_gpai": True,
        "training_compute_flops": _GPAI_SYSTEMIC_FLOPS_THRESHOLD,
    }))
    assert result.tier == "gpai-systemic"
    assert "systemic" in result.basis


def test_gpai_systemic_above_threshold():
    result = classify(AISystemCreate(**{
        **_base(),
        "is_gpai": True,
        "training_compute_flops": _GPAI_SYSTEMIC_FLOPS_THRESHOLD * 2,
    }))
    assert result.tier == "gpai-systemic"


def test_gpai_standard_below_threshold():
    result = classify(AISystemCreate(**{
        **_base(),
        "is_gpai": True,
        "training_compute_flops": _GPAI_SYSTEMIC_FLOPS_THRESHOLD / 10,
    }))
    assert result.tier == "gpai-standard"


def test_gpai_standard_zero_flops():
    result = classify(AISystemCreate(**{**_base(), "is_gpai": True}))
    assert result.tier == "gpai-standard"


def test_gpai_takes_priority_over_high_risk():
    result = classify(AISystemCreate(**{
        **_base(),
        "is_gpai": True,
        "is_biometric_identification": True,
    }))
    assert result.tier in ("gpai-standard", "gpai-systemic")


# --- Annex III high-risk ---

@pytest.mark.parametrize("flag,expected_area", [
    ("is_biometric_identification", 1),
    ("is_critical_infrastructure", 2),
    ("is_education_related", 3),
    ("is_employment_related", 4),
    ("is_credit_scoring", 5),
    ("is_public_service", 5),
    ("is_law_enforcement", 6),
    ("is_migration", 7),
    ("is_judicial_admin", 8),
])
def test_high_risk_annex_iii_flags(flag, expected_area):
    result = classify(AISystemCreate(**{**_base(), flag: True}))
    assert result.tier == "high"
    assert result.annex_iii_area == expected_area
    assert "Annex III" in result.basis


def test_high_risk_takes_priority_over_limited():
    result = classify(AISystemCreate(**{
        **_base(),
        "is_biometric_identification": True,
        "is_chatbot": True,
    }))
    assert result.tier == "high"


# --- Art. 50 limited ---

def test_limited_chatbot():
    result = classify(AISystemCreate(**{**_base(), "is_chatbot": True}))
    assert result.tier == "limited"
    assert "Art. 50" in result.basis


def test_limited_synthetic_content():
    result = classify(AISystemCreate(**{**_base(), "generates_synthetic_content": True}))
    assert result.tier == "limited"


def test_limited_both_flags():
    result = classify(AISystemCreate(**{
        **_base(),
        "is_chatbot": True,
        "generates_synthetic_content": True,
    }))
    assert result.tier == "limited"
