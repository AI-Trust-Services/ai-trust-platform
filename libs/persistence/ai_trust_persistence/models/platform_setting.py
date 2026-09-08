"""Platform settings model for storing configurable platform-wide settings."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class PlatformSetting(Base):
    """Key-value store for platform configuration.

    Settings are stored with category grouping and support various value types.
    Secrets are flagged and masked in API responses.

    Categories:
        - mail: SMTP configuration (smtp.host, smtp.port, etc.)
        - ai: LLM provider configuration (llm.provider, llm.model, etc.)
        - general: General platform settings (platform.name, etc.)
    """

    __tablename__ = "platform_settings"

    # Primary key: category.key format (e.g., "smtp.host", "llm.provider")
    key: Mapped[str] = mapped_column(String(100), primary_key=True)

    # Value stored as JSONB to support strings, numbers, booleans, objects
    value: Mapped[dict | str | int | bool | None] = mapped_column(JSONB, nullable=True)

    # Metadata
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(100), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    value_type: Mapped[str] = mapped_column(
        String(20), default="string"
    )  # string, number, boolean, secret
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)

    # Audit
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[str | None] = mapped_column(String(200), nullable=True)

    def __repr__(self) -> str:
        return f"<PlatformSetting(key={self.key!r}, category={self.category!r})>"
