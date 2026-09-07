"""marketplace image apps: registry_private flag for private-registry pulls

Adds the single non-secret column backing private-registry ``kind="image"`` pulls:

  registry_private → the image ref needs pull credentials (ghcr private, ECR, Artifactory, Docker Hub
                     private). This is the ONLY private-registry state persisted. The credentials
                     themselves are supplied at deploy time (POST /services/{id}/deploy body), written
                     into a per-app dockerconfigjson Secret (k8s) or passed to the pull in memory
                     (compose), and NEVER stored in Postgres — the same contract as OIDC_CLIENT_SECRET.
                     Defaults false, so every existing image/dockerfile/static app stays public-pull.

No new tables. ``image_ref`` already exists (added in 0016).

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-07
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "marketplace_services",
        sa.Column("registry_private", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("marketplace_services", "registry_private")
