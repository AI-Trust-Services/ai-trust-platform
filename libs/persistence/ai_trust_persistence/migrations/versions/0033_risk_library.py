"""risk library tables

Revision ID: 0033
Revises: 0032
Create Date: 2026-09-21
"""
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS library_risks (
            id VARCHAR(30) PRIMARY KEY,
            title VARCHAR(300) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category VARCHAR(200) NOT NULL DEFAULT '',
            affects_vulnerable_groups BOOLEAN NOT NULL DEFAULT FALSE,
            affects_children BOOLEAN NOT NULL DEFAULT FALSE,
            severity VARCHAR(20) NOT NULL DEFAULT 'medium',
            likelihood VARCHAR(20) NOT NULL DEFAULT 'possible',
            suggested_mitigation TEXT NOT NULL DEFAULT '',
            source VARCHAR(200) NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS library_incidents (
            id VARCHAR(30) PRIMARY KEY,
            risk_id VARCHAR(30) NOT NULL REFERENCES library_risks(id) ON DELETE CASCADE,
            title VARCHAR(300) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            occurred_at DATE,
            source_url VARCHAR(500) NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_library_incidents_risk_id ON library_incidents (risk_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS library_incidents")
    op.execute("DROP TABLE IF EXISTS library_risks")
