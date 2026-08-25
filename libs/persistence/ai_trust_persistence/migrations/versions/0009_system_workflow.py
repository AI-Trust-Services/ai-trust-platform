"""Add workflow_status, assignee_username, compliance_officer_username to ai_systems and create system_workflow_steps

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_systems", sa.Column("workflow_status", sa.String(30), nullable=False, server_default="draft"))
    op.add_column("ai_systems", sa.Column("assignee_username", sa.String(200), nullable=True))
    op.add_column("ai_systems", sa.Column("compliance_officer_username", sa.String(200), nullable=True))

    op.create_table(
        "system_workflow_steps",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column(
            "system_id",
            sa.String(20),
            sa.ForeignKey("ai_systems.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("step", sa.String(30), nullable=False),
        sa.Column("actor_username", sa.String(200), nullable=False),
        sa.Column("assignee_username", sa.String(200), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("system_workflow_steps")
    op.drop_column("ai_systems", "compliance_officer_username")
    op.drop_column("ai_systems", "assignee_username")
    op.drop_column("ai_systems", "workflow_status")
