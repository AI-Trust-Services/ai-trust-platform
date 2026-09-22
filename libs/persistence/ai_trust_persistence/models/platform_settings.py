from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
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

    # Branding - Published values (what users see)
    org_name: Mapped[str] = mapped_column(String(200), nullable=False, default="AI Trust")
    logo_horizontal_light: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_horizontal_dark: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_icon: Mapped[str | None] = mapped_column(String(500), nullable=True)
    favicon: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Brand colors (light mode)
    primary_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    secondary_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    accent_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    warning_color: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Brand colors (dark mode)
    primary_color_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)
    secondary_color_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)
    accent_color_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)
    warning_color_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Shell colors (light mode)
    sidebar_bg: Mapped[str | None] = mapped_column(String(20), nullable=True)
    header_bg: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Shell colors (dark mode)
    sidebar_bg_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)
    header_bg_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # UI element colors (light mode)
    button_bg: Mapped[str | None] = mapped_column(String(20), nullable=True)
    button_text: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_header_bg: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_border: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # UI element colors (dark mode)
    button_bg_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)
    button_text_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_header_bg_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_border_dark: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Branding - Draft values (for preview before publishing)
    org_name_draft: Mapped[str | None] = mapped_column(String(200), nullable=True)
    logo_horizontal_light_draft: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_horizontal_dark_draft: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_icon_draft: Mapped[str | None] = mapped_column(String(500), nullable=True)
    favicon_draft: Mapped[str | None] = mapped_column(String(500), nullable=True)
    primary_color_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    secondary_color_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    accent_color_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    warning_color_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    primary_color_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    secondary_color_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    accent_color_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    warning_color_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sidebar_bg_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    header_bg_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sidebar_bg_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    header_bg_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    button_bg_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    button_text_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_header_bg_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_border_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    button_bg_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    button_text_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_header_bg_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_border_dark_draft: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Branding publish metadata
    branding_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    branding_published_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
