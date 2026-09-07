"""marketplace federation: oidc_redirect_uri for oidc_federation apps

Adds the app-side OIDC callback the per-app platform-IdP client whitelists when a discovered app
uses ``auth_mode="oidc_federation"`` (real SSO transfer, zero app code). Operator-supplied; not
derivable from ``external_url``. No new tables; ``auth_mode`` stays String(20) (fits the 15-char
value "oidc_federation").

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-04
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("marketplace_services", sa.Column("oidc_redirect_uri", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("marketplace_services", "oidc_redirect_uri")
