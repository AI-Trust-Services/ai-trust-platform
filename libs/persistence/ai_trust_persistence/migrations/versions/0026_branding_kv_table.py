"""Create branding key-value table for white-labeling.

Stores branding configuration (logos, colors, org name) as key-value pairs.
Each key has a published and draft value, supporting preview before publish.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "branding",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("published", sa.Text, nullable=True),
        sa.Column("draft", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("branding")
