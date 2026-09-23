from __future__ import annotations

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class ModelCardMetric(Base):
    __tablename__ = "model_card_metrics"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    model_card_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("model_cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # assumption: value is a float. It might change in the future.
    value: Mapped[float] = mapped_column(Float, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    dataset: Mapped[str | None] = mapped_column(String(200), nullable=True)
    config: Mapped[str | None] = mapped_column(String(200), nullable=True)
    args: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
