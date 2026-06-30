"""add service_model_baselines table

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "service_model_baselines",
        sa.Column("service_name", sa.String(200), primary_key=True),
        sa.Column("model_name", sa.String(200), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("service_model_baselines")
