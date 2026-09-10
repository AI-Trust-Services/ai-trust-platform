"""Add incidents table

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS incidents (
            id VARCHAR(30) PRIMARY KEY,
            register_id VARCHAR(30) NOT NULL REFERENCES risk_registers(id) ON DELETE CASCADE,
            risk_id VARCHAR(30) REFERENCES risk_entries(id) ON DELETE SET NULL,
            title VARCHAR(500) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status VARCHAR(50) NOT NULL DEFAULT 'open',
            reported_by VARCHAR(200),
            occurred_at TIMESTAMP WITH TIME ZONE,
            attachments TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_incidents_register_id ON incidents (register_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_incidents_risk_id ON incidents (risk_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS incidents")
