from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class RiskRegister(Base):
    """Art. 9 risk register for a single AI system.

    One active register per system at a time (status = "active").
    Previous registers are archived (status = "archived") for audit trail.
    Re-assessment is required every 6 months or when any change is detected.
    """

    __tablename__ = "risk_registers"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    ai_system_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    # "draft" → "in_review" → "approved" → "archived"

    # Art. 9(2)(a): known vs foreseeable scope
    assessment_scope: Mapped[str] = mapped_column(Text, default="")
    # Residual risk acceptability (Art. 9(5))
    residual_risk_acceptable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    residual_risk_argument: Mapped[str] = mapped_column(Text, default="")
    # Named approver (Art. 9(5) — expert sign-off)
    approver_username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    # Last completed assessment timestamp — used for 6-month stale check
    last_assessment_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class RiskEntry(Base):
    """A single identified risk within a RiskRegister.

    Implements Art. 9(2)(a): known & foreseeable risks, including misuse scenarios.
    Implements Art. 9(2)(b)+(c): mitigation hierarchy.
    Implements Art. 9(9): vulnerable groups — mandatory field.
    """

    __tablename__ = "risk_entries"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    register_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("risk_registers.id", ondelete="CASCADE"), nullable=False, index=True
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(100), default="")
    article_9_step: Mapped[str] = mapped_column(String(20), default="9(2)(a)")

    # Art. 9(2)(a): known vs foreseeable distinction
    risk_type: Mapped[str] = mapped_column(String(20), default="known")
    # "known" | "foreseeable"

    # Severity × Likelihood matrix
    severity: Mapped[str] = mapped_column(String(20), default="medium")
    # "critical" | "high" | "medium" | "low"
    likelihood: Mapped[str] = mapped_column(String(20), default="possible")
    # "very_likely" | "likely" | "possible" | "unlikely"

    # Review state
    status: Mapped[str] = mapped_column(String(20), default="identified")
    # "identified" | "confirmed" | "dismissed" | "mitigated" | "closed"
    review_notes: Mapped[str] = mapped_column(Text, default="")

    # Art. 9(9): vulnerable groups — mandatory (completeness check enforced in API)
    affects_vulnerable_groups: Mapped[bool] = mapped_column(Boolean, default=False)
    vulnerable_groups: Mapped[str] = mapped_column(Text, default="")
    # JSON-serialized list of group names

    # Completeness check: risk cannot be closed without mitigation or justification
    closure_justification: Mapped[str] = mapped_column(Text, default="")

    # Source metadata
    source: Mapped[str] = mapped_column(String(50), default="manual")
    taxonomy_mappings: Mapped[str] = mapped_column(Text, default="")
    # JSON-serialized list of {taxonomy, category, identifier}

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MisuseScenario(Base):
    """Art. 9(2)(a): misuse scenario linked to a risk entry.

    Actor, scenario description, likelihood, consequences — all required.
    Optionally linked to a vulnerable group.
    """

    __tablename__ = "misuse_scenarios"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    risk_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("risk_entries.id", ondelete="CASCADE"), nullable=False, index=True
    )

    actor: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    likelihood: Mapped[str] = mapped_column(String(20), default="possible")
    consequence: Mapped[str] = mapped_column(Text, default="")
    vulnerable_group: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MitigationMeasure(Base):
    """Art. 9(2)(b)+(c): mitigation measure with enforced hierarchy.

    Hierarchy: eliminate → reduce → mitigate → inform.
    Risk cannot be closed without at least one mitigation or documented justification.
    """

    __tablename__ = "mitigation_measures"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    risk_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("risk_entries.id", ondelete="CASCADE"), nullable=False, index=True
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    # Art. 9(2)(c) hierarchy level — enforced at API level
    hierarchy_level: Mapped[str] = mapped_column(String(20), nullable=False)
    # "eliminate" | "reduce" | "mitigate" | "inform"

    implementation_guidance: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="planned")
    # "planned" | "in_progress" | "implemented" | "verified"

    assigned_to: Mapped[str | None] = mapped_column(String(200), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    override_notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ReassessmentTrigger(Base):
    """Records events that require a new risk assessment cycle.

    Triggers: 6-month schedule, documentation change, code change, description change, etc.
    When any trigger is unacknowledged, the system appears as "re-assessment needed" in the UI.
    """

    __tablename__ = "reassessment_triggers"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    ai_system_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False, index=True
    )

    trigger_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # "scheduled_6_month" | "documentation_change" | "code_change" | "description_change" | "manual"

    trigger_reason: Mapped[str] = mapped_column(Text, default="")
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    acknowledged_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    new_register_id: Mapped[str | None] = mapped_column(
        String(30), ForeignKey("risk_registers.id", ondelete="SET NULL"), nullable=True
    )
