from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class ModelCardDataset(Base):
    __tablename__ = "model_card_datasets"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    model_card_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("model_cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    revision: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # EU AI Act Art. 10(2)(b)
    origin: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_personal_data: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # EU AI Act Art. 10(2)(d)
    assumptions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # EU AI Act Art. 10(2)(e)
    assessment_availability: Mapped[str | None] = mapped_column(Text, nullable=True)
    assessment_quantity: Mapped[str | None] = mapped_column(Text, nullable=True)
    assessment_suitability: Mapped[str | None] = mapped_column(Text, nullable=True)
    # EU AI Act Art. 10(2)(f)
    potential_biases: Mapped[str | None] = mapped_column(Text, nullable=True)
