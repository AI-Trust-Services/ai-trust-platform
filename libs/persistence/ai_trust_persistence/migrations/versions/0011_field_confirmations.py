"""Add field_confirmations JSONB column to ai_systems for engineer AI-assisted review

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-19
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_systems", sa.Column("field_confirmations", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_systems", "field_confirmations")
