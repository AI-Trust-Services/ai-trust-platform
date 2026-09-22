"""Add branding columns to platform_settings for white-labeling

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-21
"""
import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Branding - Published values
    op.add_column("platform_settings", sa.Column("org_name", sa.String(200), nullable=False, server_default="AI Trust"))
    op.add_column("platform_settings", sa.Column("logo_horizontal_light", sa.String(500), nullable=True))
    op.add_column("platform_settings", sa.Column("logo_horizontal_dark", sa.String(500), nullable=True))
    op.add_column("platform_settings", sa.Column("logo_icon", sa.String(500), nullable=True))
    op.add_column("platform_settings", sa.Column("favicon", sa.String(500), nullable=True))
    op.add_column("platform_settings", sa.Column("primary_color", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("secondary_color", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("accent_color", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("warning_color", sa.String(20), nullable=True))

    # Branding - Draft values (for preview)
    op.add_column("platform_settings", sa.Column("org_name_draft", sa.String(200), nullable=True))
    op.add_column("platform_settings", sa.Column("logo_horizontal_light_draft", sa.String(500), nullable=True))
    op.add_column("platform_settings", sa.Column("logo_horizontal_dark_draft", sa.String(500), nullable=True))
    op.add_column("platform_settings", sa.Column("logo_icon_draft", sa.String(500), nullable=True))
    op.add_column("platform_settings", sa.Column("favicon_draft", sa.String(500), nullable=True))
    op.add_column("platform_settings", sa.Column("primary_color_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("secondary_color_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("accent_color_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("warning_color_draft", sa.String(20), nullable=True))

    # Branding publish metadata
    op.add_column("platform_settings", sa.Column("branding_published_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("platform_settings", sa.Column("branding_published_by", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_settings", "branding_published_by")
    op.drop_column("platform_settings", "branding_published_at")
    op.drop_column("platform_settings", "warning_color_draft")
    op.drop_column("platform_settings", "accent_color_draft")
    op.drop_column("platform_settings", "secondary_color_draft")
    op.drop_column("platform_settings", "primary_color_draft")
    op.drop_column("platform_settings", "favicon_draft")
    op.drop_column("platform_settings", "logo_icon_draft")
    op.drop_column("platform_settings", "logo_horizontal_dark_draft")
    op.drop_column("platform_settings", "logo_horizontal_light_draft")
    op.drop_column("platform_settings", "org_name_draft")
    op.drop_column("platform_settings", "warning_color")
    op.drop_column("platform_settings", "accent_color")
    op.drop_column("platform_settings", "secondary_color")
    op.drop_column("platform_settings", "primary_color")
    op.drop_column("platform_settings", "favicon")
    op.drop_column("platform_settings", "logo_icon")
    op.drop_column("platform_settings", "logo_horizontal_dark")
    op.drop_column("platform_settings", "logo_horizontal_light")
    op.drop_column("platform_settings", "org_name")
