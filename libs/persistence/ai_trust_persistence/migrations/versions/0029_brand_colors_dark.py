"""Add dark mode variants for brand colors.

Revision ID: 0028
Revises: 0027
Create Date: 2026-09-22
"""
from alembic import op
import sqlalchemy as sa


revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dark mode variants for brand colors (published)
    op.add_column("platform_settings", sa.Column("primary_color_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("secondary_color_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("accent_color_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("warning_color_dark", sa.String(20), nullable=True))

    # Dark mode variants for brand colors (draft)
    op.add_column("platform_settings", sa.Column("primary_color_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("secondary_color_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("accent_color_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("warning_color_dark_draft", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_settings", "warning_color_dark_draft")
    op.drop_column("platform_settings", "accent_color_dark_draft")
    op.drop_column("platform_settings", "secondary_color_dark_draft")
    op.drop_column("platform_settings", "primary_color_dark_draft")
    op.drop_column("platform_settings", "warning_color_dark")
    op.drop_column("platform_settings", "accent_color_dark")
    op.drop_column("platform_settings", "secondary_color_dark")
    op.drop_column("platform_settings", "primary_color_dark")
