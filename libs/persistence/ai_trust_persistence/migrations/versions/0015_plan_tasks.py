"""Add plan_tasks table and next_review_date to risk_registers

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE risk_registers
        ADD COLUMN IF NOT EXISTS next_review_date TIMESTAMP WITH TIME ZONE
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS plan_tasks (
            id VARCHAR(30) PRIMARY KEY,
            register_id VARCHAR(30) NOT NULL REFERENCES risk_registers(id) ON DELETE CASCADE,
            risk_id VARCHAR(30) REFERENCES risk_entries(id) ON DELETE SET NULL,
            title VARCHAR(500) NOT NULL,
            assigned_to VARCHAR(200),
            due_date TIMESTAMP WITH TIME ZONE,
            status VARCHAR(50) NOT NULL DEFAULT 'open',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_plan_tasks_register_id ON plan_tasks (register_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_plan_tasks_risk_id ON plan_tasks (risk_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS plan_tasks")
    op.execute("ALTER TABLE risk_registers DROP COLUMN IF EXISTS next_review_date")
