"""Add reviewer_username to risk_registers

Revision ID: 0028
Revises: 0027
Create Date: 2026-09-17
"""
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE risk_registers
        ADD COLUMN IF NOT EXISTS reviewer_username VARCHAR(200)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE risk_registers DROP COLUMN IF EXISTS reviewer_username")
