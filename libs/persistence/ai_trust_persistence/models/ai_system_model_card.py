from sqlalchemy import Column, ForeignKey, String, Table

from ai_trust_persistence.database import Base

ai_system_model_cards = Table(
    "ai_system_model_cards",
    Base.metadata,
    Column("system_id", String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), primary_key=True),
    Column("model_card_id", String(20), ForeignKey("model_cards.id", ondelete="CASCADE"), primary_key=True),
    Column("role", String(100), nullable=True),
)
