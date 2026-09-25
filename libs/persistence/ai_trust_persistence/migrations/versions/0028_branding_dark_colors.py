"""Add dark mode branding color columns.

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-21
"""
from alembic import op
import sqlalchemy as sa


revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dark mode variants for shell colors
    op.add_column("platform_settings", sa.Column("sidebar_bg_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("sidebar_bg_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("header_bg_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("header_bg_dark_draft", sa.String(20), nullable=True))

    # Dark mode variants for UI element colors
    op.add_column("platform_settings", sa.Column("button_bg_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("button_bg_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("button_text_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("button_text_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("table_header_bg_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("table_header_bg_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("table_border_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("table_border_dark_draft", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_settings", "table_border_dark_draft")
    op.drop_column("platform_settings", "table_border_dark")
    op.drop_column("platform_settings", "table_header_bg_dark_draft")
    op.drop_column("platform_settings", "table_header_bg_dark")
    op.drop_column("platform_settings", "button_text_dark_draft")
    op.drop_column("platform_settings", "button_text_dark")
    op.drop_column("platform_settings", "button_bg_dark_draft")
    op.drop_column("platform_settings", "button_bg_dark")
    op.drop_column("platform_settings", "header_bg_dark_draft")
    op.drop_column("platform_settings", "header_bg_dark")
    op.drop_column("platform_settings", "sidebar_bg_dark_draft")
    op.drop_column("platform_settings", "sidebar_bg_dark")
