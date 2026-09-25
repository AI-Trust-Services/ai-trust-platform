"""Add JSONB column for advanced branding colors.

Stores customizable colors for: tier badges, lifecycle badges, chart palette,
alert severity, workflow status, and progress indicators.

Revision ID: 0029
Revises: 0028
Create Date: 2026-09-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Advanced colors stored as JSONB for flexibility
    # Structure: { "tier_prohibited_bg": "#fef2f2", "tier_prohibited_text": "#b91c1c", ... }
    op.add_column("platform_settings", sa.Column("advanced_colors", JSONB, nullable=True))
    op.add_column("platform_settings", sa.Column("advanced_colors_draft", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("platform_settings", "advanced_colors_draft")
    op.drop_column("platform_settings", "advanced_colors")
