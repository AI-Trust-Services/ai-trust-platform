"""Add business_owners, technical_owners, git_repo_url to ai_systems

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-01
"""

import sqlalchemy as sa
from alembic import op


def upgrade() -> None:
    op.add_column("ai_systems", sa.Column("business_owners", sa.Text(), nullable=True))
    op.add_column("ai_systems", sa.Column("technical_owners", sa.Text(), nullable=True))
    op.add_column("ai_systems", sa.Column("git_repo_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_systems", "git_repo_url")
    op.drop_column("ai_systems", "technical_owners")
    op.drop_column("ai_systems", "business_owners")
