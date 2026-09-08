"""marketplace: operator-supplied env vars for deployed apps

Adds a JSONB ``env`` column to ``marketplace_services`` holding plain (NON-SECRET) environment
variables the operator supplies at registration for a dockerfile/image app. They are injected into
the deployed container (compose ``environment=`` / k8s plain ``V1EnvVar``). Secrets and registry pull
credentials never live here — those travel through the deploy-time request body and are never
persisted.

Non-null with a ``'{}'::jsonb`` server default so every existing row reads an empty map.

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "marketplace_services",
        sa.Column(
            "env",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("marketplace_services", "env")
