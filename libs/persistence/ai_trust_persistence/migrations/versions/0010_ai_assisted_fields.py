"""Add AI-assisted registration fields to ai_systems (department, use_case, people_affected, decision_context, classification_rationale)

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_systems", sa.Column("department", sa.Text(), nullable=True))
    op.add_column("ai_systems", sa.Column("use_case", sa.Text(), nullable=True))
    op.add_column("ai_systems", sa.Column("people_affected", sa.Text(), nullable=True))
    op.add_column("ai_systems", sa.Column("decision_context", sa.Text(), nullable=True))
    op.add_column("ai_systems", sa.Column("classification_rationale", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_systems", "classification_rationale")
    op.drop_column("ai_systems", "decision_context")
    op.drop_column("ai_systems", "people_affected")
    op.drop_column("ai_systems", "use_case")
    op.drop_column("ai_systems", "department")
