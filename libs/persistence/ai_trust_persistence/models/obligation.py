from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class Obligation(Base):
    """A specific compliance requirement derived from a framework.

    Defines *what* must be achieved (e.g. "Enable human oversight" / Art. 14).
    Auto-generated when an assessment's obligations are generated, or created
    manually. Status is recalculated automatically from linked controls (see
    cascade.py): applicable -> in_progress (control linked) -> fulfilled (all
    linked controls effective).
    """

    __tablename__ = "obligations"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    assessment_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ai_system_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False, index=True
    )
    framework_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("frameworks.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    article_ref: Mapped[str] = mapped_column(String(50), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="applicable", index=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    owner: Mapped[str] = mapped_column(String(200), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
