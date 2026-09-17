"""add description to plan_tasks

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-08
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE plan_tasks
        ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE plan_tasks DROP COLUMN IF EXISTS description;")
