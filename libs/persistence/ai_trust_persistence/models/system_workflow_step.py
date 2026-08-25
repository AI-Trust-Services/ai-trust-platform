from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class SystemWorkflowStep(Base):
    __tablename__ = "system_workflow_steps"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    system_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step: Mapped[str] = mapped_column(String(30), nullable=False)
    actor_username: Mapped[str] = mapped_column(String(200), nullable=False)
    assignee_username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
