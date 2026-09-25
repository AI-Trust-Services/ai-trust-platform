from __future__ import annotations

import re
from typing import Annotated

from pydantic import BaseModel, EmailStr, field_validator, BeforeValidator


# ── Color validation ─────────────────────────────────────────────────────────
# Hex color pattern: #RGB, #RRGGBB, or #RRGGBBAA (3, 6, or 8 hex digits)
_HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$")


def _validate_hex_color(v: str | None) -> str | None:
    """Validate that a string is a valid hex color or None/empty."""
    if v is None or v == "":
        return None
    if not _HEX_COLOR_PATTERN.match(v):
        raise ValueError(f"Invalid hex color: {v!r}. Must be #RGB, #RRGGBB, or #RRGGBBAA")
    return v


# Type alias for validated hex color fields
HexColor = Annotated[str | None, BeforeValidator(_validate_hex_color)]


class SmtpSettingsResponse(BaseModel):
    smtp_host: str | None
    smtp_port: int | None
    smtp_user: str | None
    has_password: bool
    smtp_from: str | None
    smtp_from_name: str | None
    smtp_ssl: bool
    smtp_starttls: bool

    model_config = {"from_attributes": True}


class SmtpSettingsUpdate(BaseModel):
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_from_name: str | None = None
    smtp_ssl: bool = False
    smtp_starttls: bool = False


class SmtpTestRequest(BaseModel):
    to: EmailStr


class SmtpTestResponse(BaseModel):
    success: bool
    message: str


class GeneralSettingsResponse(BaseModel):
    platform_name: str
    support_email: str | None

    model_config = {"from_attributes": True}


class GeneralSettingsUpdate(BaseModel):
    platform_name: str | None = None
    support_email: str | None = None


class AdminStatsResponse(BaseModel):
    user_count: int
    role_count: int
    mail_configured: bool


# ── Branding schemas ──────────────────────────────────────────────────────────


class BrandingColors(BaseModel):
    """Color palette for branding."""

    primary_color: str | None = None
    secondary_color: str | None = None
    accent_color: str | None = None
    warning_color: str | None = None


class BrandingLogos(BaseModel):
    """Logo paths/URLs for branding."""

    logo_horizontal_light: str | None = None
    logo_horizontal_dark: str | None = None
    logo_icon: str | None = None
    favicon: str | None = None


class BrandingResponse(BaseModel):
    """Full branding configuration (published or draft)."""

    org_name: str
    logo_horizontal_light: str | None = None
    logo_horizontal_dark: str | None = None
    logo_icon: str | None = None
    favicon: str | None = None
    # Brand colors (light mode)
    primary_color: str | None = None
    secondary_color: str | None = None
    accent_color: str | None = None
    warning_color: str | None = None
    # Brand colors (dark mode)
    primary_color_dark: str | None = None
    secondary_color_dark: str | None = None
    accent_color_dark: str | None = None
    warning_color_dark: str | None = None
    # Shell colors (light mode)
    sidebar_bg: str | None = None
    sidebar_text: str | None = None
    header_bg: str | None = None
    header_text: str | None = None
    # Shell colors (dark mode)
    sidebar_bg_dark: str | None = None
    sidebar_text_dark: str | None = None
    header_bg_dark: str | None = None
    header_text_dark: str | None = None
    # UI element colors (light mode)
    button_bg: str | None = None
    button_text: str | None = None
    table_header_bg: str | None = None
    table_border: str | None = None
    mfe_bg: str | None = None
    # UI element colors (dark mode)
    button_bg_dark: str | None = None
    button_text_dark: str | None = None
    table_header_bg_dark: str | None = None
    table_border_dark: str | None = None
    mfe_bg_dark: str | None = None
    # Advanced colors (tier badges, lifecycle, charts, alerts, etc.)
    advanced_colors: dict[str, str] | None = None
    # Metadata
    published_at: str | None = None  # ISO datetime
    published_by: str | None = None

    model_config = {"from_attributes": True}


class BrandingUpdate(BaseModel):
    """Update draft branding values (colors and org_name only; logos via upload endpoint)."""

    org_name: str | None = None
    # Brand colors (light mode)
    primary_color: HexColor = None
    secondary_color: HexColor = None
    accent_color: HexColor = None
    warning_color: HexColor = None
    # Brand colors (dark mode)
    primary_color_dark: HexColor = None
    secondary_color_dark: HexColor = None
    accent_color_dark: HexColor = None
    warning_color_dark: HexColor = None
    # Shell colors (light mode)
    sidebar_bg: HexColor = None
    sidebar_text: HexColor = None
    header_bg: HexColor = None
    header_text: HexColor = None
    # Shell colors (dark mode)
    sidebar_bg_dark: HexColor = None
    sidebar_text_dark: HexColor = None
    header_bg_dark: HexColor = None
    header_text_dark: HexColor = None
    # UI element colors (light mode)
    button_bg: HexColor = None
    button_text: HexColor = None
    table_header_bg: HexColor = None
    table_border: HexColor = None
    mfe_bg: HexColor = None
    # UI element colors (dark mode)
    button_bg_dark: HexColor = None
    button_text_dark: HexColor = None
    table_header_bg_dark: HexColor = None
    table_border_dark: HexColor = None
    mfe_bg_dark: HexColor = None
    # Advanced colors (tier badges, lifecycle, charts, alerts, etc.)
    advanced_colors: dict[str, str] | None = None

    @field_validator("advanced_colors", mode="before")
    @classmethod
    def validate_advanced_colors(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        """Validate all values in advanced_colors dict are valid hex colors."""
        if v is None:
            return None
        validated = {}
        for key, color in v.items():
            if color is None or color == "":
                continue
            if not _HEX_COLOR_PATTERN.match(color):
                raise ValueError(f"Invalid hex color for {key!r}: {color!r}")
            validated[key] = color
        return validated if validated else None


class BrandingStatusResponse(BaseModel):
    """Status of branding draft vs published."""

    has_unpublished_changes: bool
    published_at: str | None = None
    published_by: str | None = None


class BrandingPublishResponse(BaseModel):
    """Response after publishing branding changes."""

    success: bool
    published_at: str
    published_by: str
