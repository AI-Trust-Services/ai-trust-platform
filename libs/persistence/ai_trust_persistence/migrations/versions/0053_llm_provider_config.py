"""Create llm_provider_config singleton table for bring-your-own-LLM (issue #406)

Revision ID: 0053
Revises: 0052
Create Date: 2026-11-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_provider_config",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("base_url", sa.String(500), nullable=True),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("api_token", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("last_test_status", sa.String(20), nullable=True),
        sa.Column("last_test_message", sa.Text, nullable=True),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.func.now(),
        ),
        sa.Column("updated_by", sa.String(200), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("llm_provider_config")
