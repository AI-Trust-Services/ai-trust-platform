"""Create platform_settings singleton table for admin-configurable settings

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("platform_name", sa.String(200), nullable=False, server_default="AI Trust Platform"),
        sa.Column("support_email", sa.String(200), nullable=True),
        sa.Column("smtp_host", sa.String(200), nullable=True),
        sa.Column("smtp_port", sa.Integer, nullable=True),
        sa.Column("smtp_user", sa.String(200), nullable=True),
        sa.Column("smtp_password", sa.Text, nullable=True),
        sa.Column("smtp_from", sa.String(200), nullable=True),
        sa.Column("smtp_from_name", sa.String(200), nullable=True),
        sa.Column("smtp_ssl", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("smtp_starttls", sa.Boolean, nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_table("platform_settings")
