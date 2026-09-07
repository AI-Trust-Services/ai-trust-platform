"""marketplace dockerfile deploys: app_port, image_ref, sso_enabled

Adds the columns for building & running real server apps from a Git repo's Dockerfile (Kaniko Job on
k8s / ``docker build`` on compose), pushing to the in-cluster registry, and wiring the app to Platform
SSO with an OpenFGA role gate:

  app_port    → the port the built container listens on (k8s Service targetPort / compose upstream).
  image_ref   → the full image ref pushed to the registry, for reproducible run/redeploy.
  sso_enabled → mint a per-app Keycloak client + inject OIDC_* env + role-gate the app. Defaults false
                so existing static internal apps stay ungated (returned to everyone) — no retro-hide.

No new tables. ``kind`` already exists (String(20), "static|dockerfile").

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-04
"""
import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("marketplace_services", sa.Column("app_port", sa.Integer(), nullable=True))
    op.add_column("marketplace_services", sa.Column("image_ref", sa.Text(), nullable=True))
    op.add_column(
        "marketplace_services",
        sa.Column("sso_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("marketplace_services", "sso_enabled")
    op.drop_column("marketplace_services", "image_ref")
    op.drop_column("marketplace_services", "app_port")
