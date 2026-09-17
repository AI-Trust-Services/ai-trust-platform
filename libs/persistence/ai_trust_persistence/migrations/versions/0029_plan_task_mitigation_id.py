"""add mitigation_id to plan_tasks

Revision ID: 0029
Revises: 0028
Create Date: 2026-09-17
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plan_tasks",
        sa.Column("mitigation_id", sa.String(30), sa.ForeignKey("mitigation_measures.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_plan_tasks_mitigation_id", "plan_tasks", ["mitigation_id"])


def downgrade() -> None:
    op.drop_index("ix_plan_tasks_mitigation_id", table_name="plan_tasks")
    op.drop_column("plan_tasks", "mitigation_id")
