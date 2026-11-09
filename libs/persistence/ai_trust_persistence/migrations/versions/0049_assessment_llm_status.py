"""Add llm_status to assessments for background prefill tracking.

Tracks whether the AI questionnaire-answer pipeline is running in the background.
"pending" = pipeline running; null = done or not started; "failed" = errored.

Revision ID: 0049
Revises: 0048
Create Date: 2026-11-09
"""

import sqlalchemy as sa
from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assessments",
        sa.Column("llm_status", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("assessments", "llm_status")
