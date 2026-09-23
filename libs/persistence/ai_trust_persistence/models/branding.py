"""Branding key-value store.

Simple key-value table for branding settings. Each row has a key (e.g., 'primary_color')
and two value columns: published (what users see) and draft (for preview before publishing).

This replaces the 75+ branding columns on platform_settings. Benefits:
- No migrations needed for new branding fields (just INSERT a row)
- Simpler to query and update
- Easy to extend with new fields
"""
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class Branding(Base):
    """Key-value store for branding settings.

    Each row represents one branding field (e.g., 'primary_color', 'logo_icon').
    The key is the primary key. Published is the live value; draft is for preview.

    Special keys:
    - '_published_at': ISO datetime string of last publish
    - '_published_by': username who last published
    """
    __tablename__ = "branding"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    published: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft: Mapped[str | None] = mapped_column(Text, nullable=True)
