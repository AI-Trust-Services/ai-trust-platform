"""Pydantic v2 schemas for AI System."""
from __future__ import annotations

import math
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

VALID_LIFECYCLES = frozenset({
    "development", "testing", "conformity", "market", "post-market", "decommissioned",
})
VALID_ROLES = frozenset({"provider", "deployer", "importer", "distributor"})


class AISystemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    version: str = Field(default="1.0.0", max_length=50)
    provider: str = Field(default="")
    org_name: str = Field(default="")
    org_role: str = Field(default="provider")
    description: str = Field(default="")
    intended_purpose: str = Field(default="")
    system_type: str = Field(default="application")
    autonomy_level: str = Field(default="decision_support")
    application_url: str = Field(default="", max_length=500)
    provider_country: str = Field(default="DE", max_length=5)
    lifecycle: str = Field(default="development")

    # Art. 5 flags
    subliminal_manipulation: bool = False
    exploits_vulnerability: bool = False
    social_scoring_public: bool = False
    real_time_biometric_public: bool = False
    emotion_recognition_workplace: bool = False
    untargeted_facial_scraping: bool = False
    predictive_policing: bool = False
    biometric_categorisation_sensitive: bool = False

    # Annex III flags
    is_biometric_identification: bool = False
    is_critical_infrastructure: bool = False
    is_education_related: bool = False
    is_employment_related: bool = False
    is_credit_scoring: bool = False
    is_public_service: bool = False
    is_law_enforcement: bool = False
    is_migration: bool = False
    is_judicial_admin: bool = False

    # GPAI
    is_gpai: bool = False
    training_compute_flops: float = Field(default=0.0, ge=0.0)

    # Art. 50
    is_chatbot: bool = False
    generates_synthetic_content: bool = False

    @field_validator("lifecycle")
    @classmethod
    def lifecycle_valid(cls, v: str) -> str:
        if v not in VALID_LIFECYCLES:
            raise ValueError(f"Invalid lifecycle '{v}'")
        return v

    @field_validator("name")
    @classmethod
    def name_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v

    @field_validator("training_compute_flops")
    @classmethod
    def flops_finite(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("training_compute_flops must be a finite number")
        return v


class AISystemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    version: str | None = Field(default=None, max_length=50)
    provider: str | None = None
    org_name: str | None = None
    org_role: str | None = None
    description: str | None = None
    intended_purpose: str | None = None
    system_type: str | None = None
    autonomy_level: str | None = None
    application_url: str | None = Field(default=None, max_length=500)
    provider_country: str | None = Field(default=None, max_length=5)
    lifecycle: str | None = None
    model_id: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_whitespace(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("name must not be blank")
        return v


class ClassificationResult(BaseModel):
    tier: str
    basis: str
    obligations: list[str]
    annex_iii_area: int | None = Field(default=None, ge=1, le=8)


class AISystemResponse(BaseModel):
    id: str
    name: str
    version: str
    provider: str
    org_name: str
    org_role: str
    description: str
    intended_purpose: str
    system_type: str
    autonomy_level: str
    application_url: str
    provider_country: str
    tier: str
    basis: str
    annex_iii_area: int | None
    lifecycle: str
    compliance: float
    subliminal_manipulation: bool
    exploits_vulnerability: bool
    social_scoring_public: bool
    real_time_biometric_public: bool
    emotion_recognition_workplace: bool
    untargeted_facial_scraping: bool
    predictive_policing: bool
    biometric_categorisation_sensitive: bool
    is_biometric_identification: bool
    is_critical_infrastructure: bool
    is_education_related: bool
    is_employment_related: bool
    is_credit_scoring: bool
    is_public_service: bool
    is_law_enforcement: bool
    is_migration: bool
    is_judicial_admin: bool
    is_gpai: bool
    training_compute_flops: float
    is_chatbot: bool
    generates_synthetic_content: bool
    model_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IntakeResponse(BaseModel):
    system: AISystemResponse
    classification: ClassificationResult
