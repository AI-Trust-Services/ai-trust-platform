"""Add question_assignments table for per-question sub-assignment

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-02

Each row records that a section owner has delegated a specific questionnaire
question (identified by section + question_key) to another user to answer.
When the assignee provides their answer, answered_at is set. The section owner
can unassign (delete the row) or overwrite the answer at any time.
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "question_assignments",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column(
            "system_id",
            sa.String(20),
            sa.ForeignKey("ai_systems.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("section", sa.String(30), nullable=False),
        sa.Column("question_key", sa.String(100), nullable=False),
        sa.Column("assignee_username", sa.String(200), nullable=False),
        sa.Column("assigned_by_username", sa.String(200), nullable=False),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "system_id", "section", "question_key", name="uq_question_assignment"
        ),
    )
    op.create_index(
        "ix_question_assignments_system_id", "question_assignments", ["system_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_question_assignments_system_id", "question_assignments")
    op.drop_table("question_assignments")
