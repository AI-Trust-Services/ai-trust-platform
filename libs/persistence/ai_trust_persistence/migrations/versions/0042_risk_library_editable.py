"""Add risk_library_editable to platform_settings.

Global, admin-controlled switch: when false, users may no longer flag a new
risk for inclusion in the shared Risk Library (existing library entries are
unaffected).

Revision ID: 0042
Revises: 0041
Create Date: 2026-10-01
"""
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE platform_settings
        ADD COLUMN IF NOT EXISTS risk_library_editable BOOLEAN NOT NULL DEFAULT true
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE platform_settings
        DROP COLUMN IF EXISTS risk_library_editable
    """)
