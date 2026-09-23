from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class ModelCard(Base):
    __tablename__ = "model_cards"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    base_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    library_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    license: Mapped[str | None] = mapped_column(Text, nullable=True)
    license_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    license_link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    training_commit: Mapped[str | None] = mapped_column(String(100), nullable=True)
    validation_status: Mapped[str | None] = mapped_column(String(100), nullable=True)
    task_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    task_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="'[]'")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
