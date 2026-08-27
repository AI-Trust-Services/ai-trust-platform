"""n:m ai_systems <-> model_cards via ai_system_model_cards; drop ai_systems.model_id

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-18
"""
import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_system_model_cards",
        sa.Column("system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("model_card_id", sa.String(20), sa.ForeignKey("model_cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(100), nullable=True),
    )

    op.execute("""
        INSERT INTO ai_system_model_cards (system_id, model_card_id, role)
        SELECT id, model_id, NULL
        FROM ai_systems
        WHERE model_id IS NOT NULL
    """)

    op.drop_constraint("ai_systems_model_id_fkey", "ai_systems", type_="foreignkey")
    op.drop_column("ai_systems", "model_id")


def downgrade() -> None:
    op.add_column("ai_systems", sa.Column("model_id", sa.String(20), nullable=True))

    op.execute("""
        UPDATE ai_systems s
        SET model_id = sub.model_card_id
        FROM (
            SELECT system_id, MIN(model_card_id) AS model_card_id
            FROM ai_system_model_cards
            GROUP BY system_id
        ) sub
        WHERE s.id = sub.system_id
    """)

    op.create_foreign_key(
        "ai_systems_model_id_fkey",
        "ai_systems", "model_cards",
        ["model_id"], ["id"],
        ondelete="SET NULL",
    )

    op.drop_table("ai_system_model_cards")
