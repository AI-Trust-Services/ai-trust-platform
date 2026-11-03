"""Drop the legacy question_assignments table (single-page assessment redesign)

The section-based per-question assignment lived in ``question_assignments``
(migration 0017). The single-page assessment flow replaced it with per-question
state on ``question_states`` (assignee_username + assigned_by_username), and the
registry ``workflow.py`` endpoints that used ``question_assignments`` were
removed. This drops the now-unused table.

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-03
"""

from alembic import op
import sqlalchemy as sa

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "ix_question_assignments_system_id", table_name="question_assignments"
    )
    op.drop_table("question_assignments")


def downgrade() -> None:
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
