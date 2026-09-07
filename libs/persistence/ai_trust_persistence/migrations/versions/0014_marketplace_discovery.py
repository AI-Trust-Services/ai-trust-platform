"""marketplace discovery: federation columns + per-user/per-role enablement join tables

Adds discovery/federation columns to ``marketplace_services`` (for source="external_discovered"
apps that are already running elsewhere and integrate via the proxy) and two join tables that hold
per-user / per-role enablement (catalog visibility, not authorization).

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-04
"""
import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "marketplace_services",
        sa.Column("discovery_source", sa.String(20), nullable=False, server_default="manual"),
    )
    op.add_column("marketplace_services", sa.Column("manifest_url", sa.Text(), nullable=True))
    op.add_column("marketplace_services", sa.Column("external_url", sa.Text(), nullable=True))
    op.add_column("marketplace_services", sa.Column("health_url", sa.Text(), nullable=True))
    op.add_column("marketplace_services", sa.Column("oidc_client_id", sa.String(255), nullable=True))
    op.add_column(
        "marketplace_services",
        sa.Column("auth_mode", sa.String(20), nullable=False, server_default="bearer"),
    )
    op.add_column("marketplace_services", sa.Column("auth_header_name", sa.String(100), nullable=True))
    op.add_column("marketplace_services", sa.Column("auth_value_template", sa.Text(), nullable=True))

    op.create_table(
        "marketplace_app_enabled_users",
        sa.Column(
            "app_id",
            sa.String(20),
            sa.ForeignKey("marketplace_services.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("username", sa.String(255), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_mkt_enabled_users_username", "marketplace_app_enabled_users", ["username"])

    op.create_table(
        "marketplace_app_enabled_roles",
        sa.Column(
            "app_id",
            sa.String(20),
            sa.ForeignKey("marketplace_services.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(255), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_mkt_enabled_roles_role", "marketplace_app_enabled_roles", ["role"])


def downgrade() -> None:
    op.drop_index("ix_mkt_enabled_roles_role", table_name="marketplace_app_enabled_roles")
    op.drop_table("marketplace_app_enabled_roles")
    op.drop_index("ix_mkt_enabled_users_username", table_name="marketplace_app_enabled_users")
    op.drop_table("marketplace_app_enabled_users")

    op.drop_column("marketplace_services", "auth_value_template")
    op.drop_column("marketplace_services", "auth_header_name")
    op.drop_column("marketplace_services", "auth_mode")
    op.drop_column("marketplace_services", "oidc_client_id")
    op.drop_column("marketplace_services", "health_url")
    op.drop_column("marketplace_services", "external_url")
    op.drop_column("marketplace_services", "manifest_url")
    op.drop_column("marketplace_services", "discovery_source")
