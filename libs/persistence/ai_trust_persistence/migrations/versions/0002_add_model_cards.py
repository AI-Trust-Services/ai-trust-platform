"""add model_cards table and model_id to ai_systems

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_cards",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("provider", sa.String(100), nullable=False),
        sa.Column("version", sa.String(50), nullable=False, server_default=""),
        sa.Column("model_type", sa.String(50), nullable=False, server_default="llm"),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("open_weights", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("inference_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_model_cards_name", "model_cards", ["name"])
    op.create_index("ix_model_cards_provider", "model_cards", ["provider"])

    op.add_column(
        "ai_systems",
        sa.Column("model_id", sa.String(20), sa.ForeignKey("model_cards.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_systems", "model_id")
    op.drop_table("model_cards")
