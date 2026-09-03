"""marketplace_services table (in-app Marketplace)

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "marketplace_services",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(63), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("git_url", sa.Text(), nullable=False),
        sa.Column("git_ref", sa.String(200), nullable=False, server_default="main"),
        sa.Column("kind", sa.String(20), nullable=False, server_default="static"),
        sa.Column("source", sa.String(20), nullable=False, server_default="internal"),
        sa.Column("open_mode", sa.String(20), nullable=False, server_default="same_window"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("service_host", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_unique_constraint("uq_marketplace_services_name", "marketplace_services", ["name"])
    op.create_index("ix_marketplace_services_status", "marketplace_services", ["status"])


def downgrade() -> None:
    op.drop_index("ix_marketplace_services_status", table_name="marketplace_services")
    op.drop_constraint("uq_marketplace_services_name", "marketplace_services", type_="unique")
    op.drop_table("marketplace_services")
