"""Add extra branding color columns for shell and UI elements

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-21
"""
import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

# New color fields: published + draft variants
NEW_COLORS = [
    "sidebar_bg",
    "header_bg",
    "button_bg",
    "button_text",
    "table_header_bg",
    "table_border",
]


def upgrade() -> None:
    for col in NEW_COLORS:
        op.add_column("platform_settings", sa.Column(col, sa.String(20), nullable=True))
        op.add_column("platform_settings", sa.Column(f"{col}_draft", sa.String(20), nullable=True))


def downgrade() -> None:
    for col in NEW_COLORS:
        op.drop_column("platform_settings", f"{col}_draft")
        op.drop_column("platform_settings", col)
