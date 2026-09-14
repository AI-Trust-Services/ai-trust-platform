from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class AIProviderSetting(Base):
    __tablename__ = "ai_provider_settings"

    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_secret: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
