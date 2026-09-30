"""ai_systems org_role nullable

Revision ID: 0032
Revises: 0031
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("ai_systems", "org_role", existing_type=sa.String(30), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE ai_systems SET org_role = 'provider' WHERE org_role IS NULL")
    op.alter_column("ai_systems", "org_role", existing_type=sa.String(30), nullable=False)
