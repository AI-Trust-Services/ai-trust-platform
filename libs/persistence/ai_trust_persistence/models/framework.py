from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class Framework(Base):
    """A regulatory standard or internal policy that generates obligations.

    Platform-owned catalog (EU AI Act, NIST AI RMF, ISO/IEC 42001, …). Seeded
    by migration 0007; customers enable/disable but do not create the built-ins.
    """

    __tablename__ = "frameworks"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
