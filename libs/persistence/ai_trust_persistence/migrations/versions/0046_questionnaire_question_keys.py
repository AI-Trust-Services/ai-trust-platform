"""Clear question_states, question_comments, and questionnaire_answers for
the new ai-questionnaire.json question keys.

Old question_states rows used keys like 'submission_type', 'department' etc.
The new catalogue uses keys from ai-questionnaire.json (Scope_1, High_Risk_1...).
This migration removes the stale rows so /open can seed fresh empty rows on
the next visit.

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-05
"""

from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM question_comments")
    op.execute("DELETE FROM question_states")
    op.execute("UPDATE ai_systems SET questionnaire_answers = '{}'::jsonb")


def downgrade() -> None:
    # Data migration — cannot restore deleted rows.
    pass
