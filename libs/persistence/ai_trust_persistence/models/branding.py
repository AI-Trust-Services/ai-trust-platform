"""Branding key-value store (published + draft per field)."""
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class Branding(Base):
    __tablename__ = "branding"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    published: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft: Mapped[str | None] = mapped_column(Text, nullable=True)
