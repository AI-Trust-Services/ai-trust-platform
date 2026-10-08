"""ORM model for AI Test Bed run log (test_bed_runs)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from ai_trust_persistence.database import Base


class TestBedRun(Base):
    __tablename__ = "test_bed_runs"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    sample_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    prompt_revision: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled_sources: Mapped[dict] = mapped_column(JSONB, nullable=False)
    model: Mapped[str | None] = mapped_column(Text, nullable=True)
    knowledge_revision: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_test_bed_runs_sample_id", "sample_id"),)
