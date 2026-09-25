from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class ModelCardDatasetMeasurement(Base):
    __tablename__ = "model_card_dataset_measurements"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("model_card_datasets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    measure: Mapped[str] = mapped_column(String(200), nullable=False)
    # Assumption: only float
    value: Mapped[str] = mapped_column(String(200), nullable=False)
