"""add library_risk_id to risk_entries

Revision ID: 0034
Revises: 0033
Create Date: 2026-09-22
"""
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE risk_entries
        ADD COLUMN IF NOT EXISTS library_risk_id VARCHAR(30)
            REFERENCES library_risks(id) ON DELETE SET NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_risk_entries_library_risk_id
        ON risk_entries (library_risk_id)
        WHERE library_risk_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_risk_entries_library_risk_id")
    op.execute("ALTER TABLE risk_entries DROP COLUMN IF EXISTS library_risk_id")
