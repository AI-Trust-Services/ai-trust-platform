from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, String, Table, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base
from ai_trust_persistence.models._tenant import TenantMixin

# Many-to-many: one control can satisfy obligations across multiple assessments
# and frameworks; one obligation can be satisfied by multiple controls.
control_obligations = Table(
    "control_obligations",
    Base.metadata,
    Column("control_id", String(30), ForeignKey("controls.id", ondelete="CASCADE"), primary_key=True),
    Column("obligation_id", String(30), ForeignKey("obligations.id", ondelete="CASCADE"), primary_key=True),
)


class Control(TenantMixin, Base):
    """A technical or organisational measure that satisfies obligations.

    Defines *how* an obligation is met. ai_system_id is nullable: a null value
    means the control is org-wide (applies across all systems), per spec
    CTL-FR-07. Effectiveness is driven by linked evidence (see cascade.py):
    approved evidence -> control becomes 'effective'.
    """

    __tablename__ = "controls"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    ai_system_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("ai_systems.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Stable slug ("{article_ref}:{slug}") for auto-generated controls; used as the
    # carry-forward key across assessment cycles. NULL for manually-created controls.
    # Deliberately non-unique: the same slug recurs each cycle and org-wide controls
    # span multiple assessments.
    control_ref: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(50), default="general")
    status: Mapped[str] = mapped_column(String(30), default="not_started", index=True)
    effectiveness: Mapped[str] = mapped_column(String(20), default="medium")
    owner: Mapped[str] = mapped_column(String(200), default="")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
