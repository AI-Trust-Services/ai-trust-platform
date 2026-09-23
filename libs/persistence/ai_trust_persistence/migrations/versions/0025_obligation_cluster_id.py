"""Add cluster_id to obligations (join key to CSV obligation clusters)

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-07
"""
import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Stable cluster identifier (e.g. "P-RM", "D-LIM") linking an obligation back
    # to its source obligation cluster. Nullable — retained sets and manually
    # created obligations may leave it blank (carry-forward falls back to
    # article_ref). Non-unique — the same cluster recurs each assessment cycle.
    op.add_column("obligations", sa.Column("cluster_id", sa.String(50), nullable=True))
    op.create_index("ix_obligations_cluster_id", "obligations", ["cluster_id"])


def downgrade() -> None:
    op.drop_index("ix_obligations_cluster_id", table_name="obligations")
    op.drop_column("obligations", "cluster_id")
