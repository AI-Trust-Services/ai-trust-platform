"""Add ai_references (JSONB) and ai_explanation (Text) to question_states.

These store the per-question evidence references and explanation text returned
by the questionnaire-run pipeline, surfaced in the QuestionView confidence modal.

Revision ID: 0048
Revises: 0047
Create Date: 2026-11-05
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "question_states",
        sa.Column("ai_references", JSONB, nullable=True),
    )
    op.add_column(
        "question_states",
        sa.Column("ai_explanation", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("question_states", "ai_explanation")
    op.drop_column("question_states", "ai_references")
