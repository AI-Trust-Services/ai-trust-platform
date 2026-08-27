"""Add questionnaire_answers, business_assignee_username, technical_assignee_username to ai_systems

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-26
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_systems", sa.Column("questionnaire_answers", postgresql.JSONB(), nullable=True))
    op.add_column("ai_systems", sa.Column("business_assignee_username", sa.String(200), nullable=True))
    op.add_column("ai_systems", sa.Column("technical_assignee_username", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_systems", "technical_assignee_username")
    op.drop_column("ai_systems", "business_assignee_username")
    op.drop_column("ai_systems", "questionnaire_answers")
