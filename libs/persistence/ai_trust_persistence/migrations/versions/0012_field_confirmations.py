"""Add field_confirmations JSONB column to ai_systems for engineer AI-assisted review

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-19
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_systems", sa.Column("field_confirmations", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_systems", "field_confirmations")
