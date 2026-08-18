from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class AISystem(Base):
    __tablename__ = "ai_systems"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(50), default="1.0.0")
    provider: Mapped[str] = mapped_column(String(200), default="")
    org_name: Mapped[str] = mapped_column(String(200), default="")
    org_role: Mapped[str] = mapped_column(String(30), default="provider")
    description: Mapped[str] = mapped_column(Text, default="")
    intended_purpose: Mapped[str] = mapped_column(Text, default="")
    system_type: Mapped[str] = mapped_column(String(30), default="application")
    autonomy_level: Mapped[str] = mapped_column(String(50), default="decision_support")
    application_url: Mapped[str] = mapped_column(String(500), default="")
    provider_country: Mapped[str] = mapped_column(String(5), default="DE")

    tier: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    basis: Mapped[str] = mapped_column(Text, default="")
    annex_iii_area: Mapped[int | None] = mapped_column(Integer, nullable=True)

    lifecycle: Mapped[str] = mapped_column(String(30), default="development", index=True)
    compliance: Mapped[float] = mapped_column(Float, default=0.0)  # 0.0–100.0 percentage

    subliminal_manipulation: Mapped[bool] = mapped_column(Boolean, default=False)
    exploits_vulnerability: Mapped[bool] = mapped_column(Boolean, default=False)
    social_scoring_public: Mapped[bool] = mapped_column(Boolean, default=False)
    real_time_biometric_public: Mapped[bool] = mapped_column(Boolean, default=False)
    emotion_recognition_workplace: Mapped[bool] = mapped_column(Boolean, default=False)
    untargeted_facial_scraping: Mapped[bool] = mapped_column(Boolean, default=False)
    predictive_policing: Mapped[bool] = mapped_column(Boolean, default=False)
    biometric_categorisation_sensitive: Mapped[bool] = mapped_column(Boolean, default=False)

    is_biometric_identification: Mapped[bool] = mapped_column(Boolean, default=False)
    is_critical_infrastructure: Mapped[bool] = mapped_column(Boolean, default=False)
    is_education_related: Mapped[bool] = mapped_column(Boolean, default=False)
    is_employment_related: Mapped[bool] = mapped_column(Boolean, default=False)
    is_credit_scoring: Mapped[bool] = mapped_column(Boolean, default=False)
    is_public_service: Mapped[bool] = mapped_column(Boolean, default=False)
    is_law_enforcement: Mapped[bool] = mapped_column(Boolean, default=False)
    is_migration: Mapped[bool] = mapped_column(Boolean, default=False)
    is_judicial_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    is_gpai: Mapped[bool] = mapped_column(Boolean, default=False)
    training_compute_flops: Mapped[float] = mapped_column(Float, default=0.0)

    is_chatbot: Mapped[bool] = mapped_column(Boolean, default=False)
    generates_synthetic_content: Mapped[bool] = mapped_column(Boolean, default=False)

    workflow_status: Mapped[str] = mapped_column(String(30), nullable=False, default="draft")
    assignee_username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    compliance_officer_username: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
