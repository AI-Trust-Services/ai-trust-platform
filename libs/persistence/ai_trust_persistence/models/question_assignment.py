from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class QuestionAssignment(Base):
    __tablename__ = "question_assignments"
    __table_args__ = (UniqueConstraint("system_id", "section", "question_key", name="uq_question_assignment"),)

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    system_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False, index=True
    )
    section: Mapped[str] = mapped_column(String(30), nullable=False)
    question_key: Mapped[str] = mapped_column(String(100), nullable=False)
    assignee_username: Mapped[str] = mapped_column(String(200), nullable=False)
    assigned_by_username: Mapped[str] = mapped_column(String(200), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
