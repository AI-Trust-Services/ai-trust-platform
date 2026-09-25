"""drop unused branding columns from platform_settings

Now that branding data lives in the key-value `branding` table, these 75+ columns
on platform_settings are obsolete. Data was migrated in 0031.

Revision ID: 6282ecfeacfe
Revises: 0031
Create Date: 2026-09-25 15:05:07.222992
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '0032'
down_revision = '0031'
branch_labels = None
depends_on = None


# All branding columns to drop (migrated to branding table in 0031)
BRANDING_COLUMNS = [
    # Logos - published
    "logo_horizontal_light",
    "logo_horizontal_dark",
    "logo_icon",
    "favicon",
    # Brand colors (light mode) - published
    "primary_color",
    "secondary_color",
    "accent_color",
    "warning_color",
    # Brand colors (dark mode) - published
    "primary_color_dark",
    "secondary_color_dark",
    "accent_color_dark",
    "warning_color_dark",
    # Shell colors (light mode) - published
    "sidebar_bg",
    "sidebar_text",
    "header_bg",
    "header_text",
    # Shell colors (dark mode) - published
    "sidebar_bg_dark",
    "sidebar_text_dark",
    "header_bg_dark",
    "header_text_dark",
    # UI element colors (light mode) - published
    "button_bg",
    "button_text",
    "table_header_bg",
    "table_border",
    "mfe_bg",
    # UI element colors (dark mode) - published
    "button_bg_dark",
    "button_text_dark",
    "table_header_bg_dark",
    "table_border_dark",
    "mfe_bg_dark",
    # Logos - draft
    "org_name_draft",
    "logo_horizontal_light_draft",
    "logo_horizontal_dark_draft",
    "logo_icon_draft",
    "favicon_draft",
    # Brand colors - draft
    "primary_color_draft",
    "secondary_color_draft",
    "accent_color_draft",
    "warning_color_draft",
    "primary_color_dark_draft",
    "secondary_color_dark_draft",
    "accent_color_dark_draft",
    "warning_color_dark_draft",
    # Shell colors - draft
    "sidebar_bg_draft",
    "sidebar_text_draft",
    "header_bg_draft",
    "header_text_draft",
    "sidebar_bg_dark_draft",
    "sidebar_text_dark_draft",
    "header_bg_dark_draft",
    "header_text_dark_draft",
    # UI element colors - draft
    "button_bg_draft",
    "button_text_draft",
    "table_header_bg_draft",
    "table_border_draft",
    "mfe_bg_draft",
    "button_bg_dark_draft",
    "button_text_dark_draft",
    "table_header_bg_dark_draft",
    "table_border_dark_draft",
    "mfe_bg_dark_draft",
]


def upgrade() -> None:
    # Drop all branding columns from platform_settings
    for col in BRANDING_COLUMNS:
        op.drop_column("platform_settings", col)

    # Drop JSONB advanced_colors columns
    op.drop_column("platform_settings", "advanced_colors")
    op.drop_column("platform_settings", "advanced_colors_draft")

    # Drop org_name (moved to branding table)
    op.drop_column("platform_settings", "org_name")

    # Drop publish metadata
    op.drop_column("platform_settings", "branding_published_at")
    op.drop_column("platform_settings", "branding_published_by")


def downgrade() -> None:
    # Re-add columns for rollback (nullable, no data restoration)
    from sqlalchemy import Boolean, DateTime, Integer, String, Text

    # Re-add org_name first (not nullable)
    op.add_column("platform_settings", sa.Column("org_name", String(200), nullable=False, server_default="AI Trust"))

    # Re-add all branding columns (nullable String for colors/paths)
    for col in BRANDING_COLUMNS:
        if "logo" in col or "favicon" in col:
            op.add_column("platform_settings", sa.Column(col, String(500), nullable=True))
        elif "name" in col:
            op.add_column("platform_settings", sa.Column(col, String(200), nullable=True))
        else:
            op.add_column("platform_settings", sa.Column(col, String(20), nullable=True))

    # Re-add JSONB advanced_colors
    op.add_column("platform_settings", sa.Column("advanced_colors", JSONB, nullable=True))
    op.add_column("platform_settings", sa.Column("advanced_colors_draft", JSONB, nullable=True))

    # Re-add publish metadata
    op.add_column("platform_settings", sa.Column("branding_published_at", DateTime(timezone=True), nullable=True))
    op.add_column("platform_settings", sa.Column("branding_published_by", String(200), nullable=True))
