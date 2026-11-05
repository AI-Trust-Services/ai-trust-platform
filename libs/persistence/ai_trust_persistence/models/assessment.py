from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class Assessment(Base):
    """A structured evaluation of an AI system against a framework.

    Assessments are the entry point into the governance lifecycle: they
    auto-generate obligations (from the system's risk tier), which are satisfied
    by controls and demonstrated by evidence. Multiple assessments may exist per
    (ai_system_id, framework_id); the most recent by created_at is the current
    one. Once approved, an assessment is immutable (see routers/assessments.py).
    """

    __tablename__ = "assessments"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    ai_system_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("ai_systems.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    framework_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("frameworks.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(50), default="compliance")
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    confirmed_by: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Per-cycle classification snapshot (single-page EU AI Act flow). The live
    # classification lives on the AISystem row and is overwritten each cycle; these
    # capture what THIS assessment was issued at, so a historical read-only "View
    # results" shows the cycle exactly as approved. Set by issue_classification.
    tier: Mapped[str | None] = mapped_column(String(30), nullable=True)
    basis: Mapped[str | None] = mapped_column(Text, nullable=True)
    annex_iii_area: Mapped[int | None] = mapped_column(Integer, nullable=True)
    org_role: Mapped[str | None] = mapped_column(String(30), nullable=True)
    co_issued_transparency: Mapped[bool | None] = mapped_column(nullable=True)
    assessment_sources: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    classification_rationale: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
