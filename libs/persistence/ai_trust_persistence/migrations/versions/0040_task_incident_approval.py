"""Add approved/approved_by/approved_at to plan_tasks and incidents, plus
assigned_to on incidents (mirrors plan_tasks.assigned_to so both entities have
a consistent owner fallback for approval when not linked to a risk).

Revision ID: 0040
Revises: 0039
Create Date: 2026-09-30
"""
from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE plan_tasks
        ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS approved_by VARCHAR(200),
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
    """)
    op.execute("""
        ALTER TABLE incidents
        ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(200),
        ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS approved_by VARCHAR(200),
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE incidents
        DROP COLUMN IF EXISTS approved_at,
        DROP COLUMN IF EXISTS approved_by,
        DROP COLUMN IF EXISTS approved,
        DROP COLUMN IF EXISTS assigned_to
    """)
    op.execute("""
        ALTER TABLE plan_tasks
        DROP COLUMN IF EXISTS approved_at,
        DROP COLUMN IF EXISTS approved_by,
        DROP COLUMN IF EXISTS approved
    """)
