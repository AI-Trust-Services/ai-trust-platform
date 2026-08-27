from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class AISystemModelCard(Base):
    __tablename__ = "ai_system_model_cards"

    system_id: Mapped[str] = mapped_column(String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), primary_key=True)
    model_card_id: Mapped[str] = mapped_column(String(20), ForeignKey("model_cards.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str | None] = mapped_column(String(100), nullable=True)
