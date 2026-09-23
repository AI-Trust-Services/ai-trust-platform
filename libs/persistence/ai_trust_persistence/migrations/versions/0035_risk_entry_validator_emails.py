"""Add engineer_email, officer_email, engineer_declined, officer_declined to risk_entries

Revision ID: 0035
Revises: 0034
Create Date: 2026-09-22
"""
from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE risk_entries
        ADD COLUMN IF NOT EXISTS engineer_email VARCHAR(255),
        ADD COLUMN IF NOT EXISTS officer_email VARCHAR(255),
        ADD COLUMN IF NOT EXISTS engineer_declined BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS officer_declined BOOLEAN NOT NULL DEFAULT false
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE risk_entries
        DROP COLUMN IF EXISTS engineer_email,
        DROP COLUMN IF EXISTS officer_email,
        DROP COLUMN IF EXISTS engineer_declined,
        DROP COLUMN IF EXISTS officer_declined
    """)
