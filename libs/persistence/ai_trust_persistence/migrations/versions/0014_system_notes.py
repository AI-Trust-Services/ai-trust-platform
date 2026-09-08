"""Add system_notes table.

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-27
"""
from alembic import op
import sqlalchemy as sa


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_notes",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column(
            "ai_system_id",
            sa.String(20),
            sa.ForeignKey("ai_systems.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("author_username", sa.String(200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("system_notes")
