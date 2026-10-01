"""Add a persisted, owner/reviewer-gated two-step delete to risk_entries,
plan_tasks and incidents: pending_delete/pending_delete_by/pending_delete_at.

Previously the "mark for deletion, then confirm" flow was local UI state only
(a React Set), invisible to other users and to a freshly loaded page. This
persists the proposal so any user sees the item flagged, while only the risk
owner or the register's reviewer can confirm (or cancel) it.

Revision ID: 0041
Revises: 0040
Create Date: 2026-09-30
"""
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE risk_entries
        ADD COLUMN IF NOT EXISTS pending_delete BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS pending_delete_by VARCHAR(200),
        ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMPTZ
    """)
    op.execute("""
        ALTER TABLE plan_tasks
        ADD COLUMN IF NOT EXISTS pending_delete BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS pending_delete_by VARCHAR(200),
        ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMPTZ
    """)
    op.execute("""
        ALTER TABLE incidents
        ADD COLUMN IF NOT EXISTS pending_delete BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS pending_delete_by VARCHAR(200),
        ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMPTZ
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE incidents
        DROP COLUMN IF EXISTS pending_delete_at,
        DROP COLUMN IF EXISTS pending_delete_by,
        DROP COLUMN IF EXISTS pending_delete
    """)
    op.execute("""
        ALTER TABLE plan_tasks
        DROP COLUMN IF EXISTS pending_delete_at,
        DROP COLUMN IF EXISTS pending_delete_by,
        DROP COLUMN IF EXISTS pending_delete
    """)
    op.execute("""
        ALTER TABLE risk_entries
        DROP COLUMN IF EXISTS pending_delete_at,
        DROP COLUMN IF EXISTS pending_delete_by,
        DROP COLUMN IF EXISTS pending_delete
    """)
