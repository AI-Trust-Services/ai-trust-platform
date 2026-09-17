"""Add responsible_role, deadline, engineer_confirmed, officer_confirmed to risk_entries

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-15
"""
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE risk_entries
        ADD COLUMN IF NOT EXISTS responsible_role VARCHAR(50),
        ADD COLUMN IF NOT EXISTS deadline TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS engineer_confirmed BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS officer_confirmed BOOLEAN NOT NULL DEFAULT false
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE risk_entries
        DROP COLUMN IF EXISTS responsible_role,
        DROP COLUMN IF EXISTS deadline,
        DROP COLUMN IF EXISTS engineer_confirmed,
        DROP COLUMN IF EXISTS officer_confirmed
    """)
