"""Add article_ref to controls; widen obligations.article_ref

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Per-requirement AI Act article reference (e.g. "Art. 9 (1)(2)"), derived from
    # the AI Act Requirements catalogue. Nullable — retained sets (GPAI/NIST/ISO)
    # and manually-created controls leave it blank.
    op.add_column("controls", sa.Column("article_ref", sa.String(100), nullable=True))
    # Obligation article_ref now holds the aggregate of the cluster's distinct
    # top-level articles (e.g. "Art. 9, Art. 11, Art. 72"), which can exceed 50 chars.
    op.alter_column(
        "obligations", "article_ref",
        existing_type=sa.String(50), type_=sa.String(100), existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "obligations", "article_ref",
        existing_type=sa.String(100), type_=sa.String(50), existing_nullable=False,
    )
    op.drop_column("controls", "article_ref")
