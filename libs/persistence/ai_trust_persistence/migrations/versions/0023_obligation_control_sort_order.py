"""Add sort_order to obligations and controls (stable catalogue ordering)

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Position within the source catalogue, assigned at generation so listings can
    # be shown in catalogue order rather than by created_at (all rows of one
    # generation share the same transaction timestamp, so created_at alone gives
    # no stable order). Defaults to 0 for pre-existing and manually-created rows.
    op.add_column("obligations", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("controls", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("controls", "sort_order")
    op.drop_column("obligations", "sort_order")
