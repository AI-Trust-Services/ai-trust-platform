from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actor_username: Mapped[str] = mapped_column(String(200), nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(50), nullable=False)
    ai_system_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ai_system_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source: Mapped[str] = mapped_column(String(20), nullable=False, server_default="ui")

    __table_args__ = (
        Index("ix_audit_events_created", "created_at"),
        Index("ix_audit_events_ai_system_created", "ai_system_id", "created_at"),
    )
