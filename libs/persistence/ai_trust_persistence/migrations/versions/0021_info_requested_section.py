"""Add info_requested_section to ai_systems for section-targeted CO info requests

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-15
"""
import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_systems",
        sa.Column("info_requested_section", sa.String(30), nullable=True),
    )
    op.create_check_constraint(
        "ck_ai_systems_info_requested_section",
        "ai_systems",
        "info_requested_section IN ('business', 'technical')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_systems_info_requested_section", "ai_systems")
    op.drop_column("ai_systems", "info_requested_section")
