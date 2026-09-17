"""add registry_snapshot to risk_registers

Revision ID: 0030
Revises: 0029
Create Date: 2026-09-17
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "risk_registers",
        sa.Column("registry_snapshot", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("risk_registers", "registry_snapshot")
