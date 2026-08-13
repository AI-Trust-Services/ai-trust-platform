from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base
from ai_trust_persistence.models._tenant import TenantMixin


class Assessment(TenantMixin, Base):
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
        String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False, index=True
    )
    framework_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("frameworks.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(50), default="compliance")
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
