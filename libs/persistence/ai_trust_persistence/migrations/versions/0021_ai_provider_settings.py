"""Add ai_provider_settings key-value table for LLM provider configuration

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-14
"""
import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_provider_settings",
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", sa.Text, nullable=True),
        sa.Column("is_secret", sa.Boolean, nullable=False, server_default="false"),
        sa.PrimaryKeyConstraint("provider", "key"),
    )


def downgrade() -> None:
    op.drop_table("ai_provider_settings")
