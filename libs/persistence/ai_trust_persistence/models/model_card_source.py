from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class ModelCardSource(Base):
    __tablename__ = "model_card_sources"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    model_card_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("model_cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
