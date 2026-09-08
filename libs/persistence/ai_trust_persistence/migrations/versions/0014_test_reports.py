"""Add test_reports table

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS test_reports (
            id VARCHAR(30) PRIMARY KEY,
            risk_id VARCHAR(30) REFERENCES risk_entries(id) ON DELETE CASCADE,
            mitigation_id VARCHAR(30) REFERENCES mitigation_measures(id) ON DELETE SET NULL,
            title VARCHAR(300) NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            findings TEXT NOT NULL DEFAULT '',
            result VARCHAR(20) NOT NULL DEFAULT 'pass',
            author VARCHAR(200),
            attachments TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_test_reports_risk_id ON test_reports (risk_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_test_reports_mitigation_id ON test_reports (mitigation_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS test_reports")
