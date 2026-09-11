"""Add questionnaire_answers, business_assignee_username, technical_assignee_username to ai_systems

<<<<<<<< HEAD:libs/persistence/ai_trust_persistence/migrations/versions/0015_questionnaire_workflow.py
Revision ID: 0015
Revises: 0014
========
Revision ID: 0019
Revises: 0018
>>>>>>>> 7924be1 (fix: renumber conflicting 0014 migrations to 0019/0020):libs/persistence/ai_trust_persistence/migrations/versions/0019_questionnaire_workflow.py
Create Date: 2026-08-26
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

<<<<<<<< HEAD:libs/persistence/ai_trust_persistence/migrations/versions/0015_questionnaire_workflow.py
revision = "0015"
down_revision = "0014"
========
revision = "0019"
down_revision = "0018"
>>>>>>>> 7924be1 (fix: renumber conflicting 0014 migrations to 0019/0020):libs/persistence/ai_trust_persistence/migrations/versions/0019_questionnaire_workflow.py
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
