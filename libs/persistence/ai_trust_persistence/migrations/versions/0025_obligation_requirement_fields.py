"""Add cluster_id/sort_order to obligations, article_ref/sort_order to requirements, widen obligation article_ref

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

    # Position within the source catalogue for stable ordering (all rows of one
    # generation share the same transaction timestamp, so created_at alone gives
    # no stable order). Defaults to 0 for pre-existing and manually-created rows.
    op.add_column("obligations", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("requirements", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))

    # Per-requirement AI Act article reference (e.g. "Art. 9 (1)(2)"), derived from
    # the AI Act Requirements catalogue. Nullable — retained sets and manually-created
    # requirements leave it blank.
    op.add_column("requirements", sa.Column("article_ref", sa.String(100), nullable=True))

    # Obligation article_ref now holds the aggregate of a cluster's distinct top-level
    # articles (e.g. "Art. 9, Art. 11, Art. 72"), which can exceed 50 chars.
    op.alter_column(
        "obligations", "article_ref",
        existing_type=sa.String(50), type_=sa.String(100), existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "obligations", "article_ref",
        existing_type=sa.String(100), type_=sa.String(50), existing_nullable=False,
    )
    op.drop_column("requirements", "article_ref")
    op.drop_column("requirements", "sort_order")
    op.drop_column("obligations", "sort_order")
    op.drop_index("ix_obligations_cluster_id", table_name="obligations")
    op.drop_column("obligations", "cluster_id")
