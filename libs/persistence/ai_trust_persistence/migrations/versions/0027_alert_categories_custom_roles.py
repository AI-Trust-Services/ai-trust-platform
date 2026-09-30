"""Add alert_categories to custom_roles

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-15
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "custom_roles",
        sa.Column("alert_categories", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("custom_roles", "alert_categories")
