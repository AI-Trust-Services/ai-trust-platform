"""Per-question answer-change timestamp for the mandatory-comment-on-change gate

The single-page assessment requires a justifying comment when the owner confirms
an answer they changed from the AI pre-fill. To enforce that the comment was
recorded *after* the change (not just that any comment exists), ``question_states``
needs to record when the answer last changed. ``confirm_question`` compares
``QuestionComment.created_at`` against this.

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-05
"""

from alembic import op
import sqlalchemy as sa

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "question_states",
        sa.Column("answer_changed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("question_states", "answer_changed_at")
