from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class Control(Base):
    """A technical or organisational measure that satisfies one obligation.

    Belongs to exactly one obligation (1:N). Effectiveness is driven by linked
    evidence (see cascade.py): approved evidence -> control becomes 'fulfilled'.
    """

    __tablename__ = "controls"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    obligation_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("obligations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assessment_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalized from obligation for efficient evidence filtering.
    ai_system_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("ai_systems.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Stable slug ("{article_ref}:{slug}") for auto-generated controls; carry-forward key
    # across assessment cycles. NULL for manually-created controls.
    control_ref: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(50), default="general")
    status: Mapped[str] = mapped_column(String(30), default="open", index=True)
    effectiveness: Mapped[str] = mapped_column(String(20), default="medium")
    owner: Mapped[str] = mapped_column(String(200), default="")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
