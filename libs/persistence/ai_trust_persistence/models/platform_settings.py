from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class PlatformSettings(Base):
    __tablename__ = "platform_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    platform_name: Mapped[str] = mapped_column(String(200), nullable=False, default="AI Trust Platform")
    support_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    smtp_host: Mapped[str | None] = mapped_column(String(200), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    smtp_user: Mapped[str | None] = mapped_column(String(200), nullable=True)
    smtp_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    smtp_from: Mapped[str | None] = mapped_column(String(200), nullable=True)
    smtp_from_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    smtp_ssl: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    smtp_starttls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
