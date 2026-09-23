from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class ModelCardFeatureStoreGroup(Base):
    __tablename__ = "model_card_feature_store_groups"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    feature_store_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("model_card_feature_stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    origin: Mapped[str | None] = mapped_column(String(200), nullable=True)
