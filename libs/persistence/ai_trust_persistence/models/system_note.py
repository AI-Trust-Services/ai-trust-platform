"""SystemNote model for notes attached to AI systems."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class SystemNote(Base):
    """A note attached to an AI system."""

    __tablename__ = "system_notes"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # SNOTE-XXXXXXXX
    ai_system_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("ai_systems.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_username: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
