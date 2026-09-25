"""Model card redesign: replace thin table with full structured schema.

Drops old model_cards (name/provider/model_type/open_weights/inference_url)
and recreates with rich fields plus 7 child tables.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop FK on ai_system_model_cards before dropping the parent table
    op.drop_constraint("ai_system_model_cards_model_card_id_fkey", "ai_system_model_cards", type_="foreignkey")

    op.drop_index("ix_model_cards_name", "model_cards")
    op.drop_index("ix_model_cards_provider", "model_cards")
    op.drop_table("model_cards")

    op.create_table(
        "model_cards",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.String(50), nullable=True),
        sa.Column("base_model", sa.String(200), nullable=True),
        sa.Column("library_name", sa.String(100), nullable=True),
        sa.Column("license", sa.String(100), nullable=True),
        sa.Column("license_name", sa.String(200), nullable=True),
        sa.Column("license_link", sa.String(500), nullable=True),
        sa.Column("training_commit", sa.String(100), nullable=True),
        sa.Column("validation_status", sa.String(100), nullable=True),
        sa.Column("task_type", sa.String(100), nullable=True),
        sa.Column("task_name", sa.String(200), nullable=True),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_model_cards_name", "model_cards", ["name"])

    op.create_foreign_key(
        "ai_system_model_cards_model_card_id_fkey",
        "ai_system_model_cards", "model_cards",
        ["model_card_id"], ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "model_card_metrics",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("model_card_id", sa.String(20), sa.ForeignKey("model_cards.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("value", sa.Float, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("dataset", sa.String(200), nullable=True),
        sa.Column("config", sa.String(200), nullable=True),
        sa.Column("args", postgresql.JSONB, nullable=True),
    )

    op.create_table(
        "model_card_sources",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("model_card_id", sa.String(20), sa.ForeignKey("model_cards.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("name", sa.String(200), nullable=True),
    )

    op.create_table(
        "model_card_datasets",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("model_card_id", sa.String(20), sa.ForeignKey("model_cards.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("revision", sa.String(200), nullable=True),
        sa.Column("origin", sa.Text, nullable=True),
        sa.Column("is_personal_data", sa.Boolean, nullable=True),
        sa.Column("assumptions", sa.Text, nullable=True),
        sa.Column("assessment_availability", sa.Text, nullable=True),
        sa.Column("assessment_quantity", sa.Text, nullable=True),
        sa.Column("assessment_suitability", sa.Text, nullable=True),
        sa.Column("potential_biases", sa.Text, nullable=True),
    )

    op.create_table(
        "model_card_dataset_preparations",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("dataset_id", sa.String(20), sa.ForeignKey("model_card_datasets.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("order", sa.Integer, nullable=False),
        sa.Column("operation", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
    )

    op.create_table(
        "model_card_dataset_measurements",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("dataset_id", sa.String(20), sa.ForeignKey("model_card_datasets.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("measure", sa.String(200), nullable=False),
        sa.Column("value", sa.String(200), nullable=False),
    )

    op.create_table(
        "model_card_feature_stores",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("dataset_id", sa.String(20), sa.ForeignKey("model_card_datasets.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("store_name", sa.String(200), nullable=False),
    )

    op.create_table(
        "model_card_feature_store_groups",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("feature_store_id", sa.String(20), sa.ForeignKey("model_card_feature_stores.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.String(100), nullable=True),
        sa.Column("origin", sa.String(200), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("model_card_feature_store_groups")
    op.drop_table("model_card_feature_stores")
    op.drop_table("model_card_dataset_measurements")
    op.drop_table("model_card_dataset_preparations")
    op.drop_table("model_card_datasets")
    op.drop_table("model_card_sources")
    op.drop_table("model_card_metrics")

    op.drop_constraint("ai_system_model_cards_model_card_id_fkey", "ai_system_model_cards", type_="foreignkey")
    op.drop_index("ix_model_cards_name", "model_cards")
    op.drop_table("model_cards")

    op.create_table(
        "model_cards",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("provider", sa.String(100), nullable=False, server_default=""),
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

    op.create_foreign_key(
        "ai_system_model_cards_model_card_id_fkey",
        "ai_system_model_cards", "model_cards",
        ["model_card_id"], ["id"],
        ondelete="CASCADE",
    )
