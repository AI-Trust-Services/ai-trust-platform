"""marketplace: health-probe columns for discovered apps

Adds the two columns written by ``marketplace-health-worker`` when it probes a discovered app's
operator-supplied ``health_url``:

  health_status     → last probe outcome: "up" | "down" | "unknown". Null until the first probe.
  health_checked_at → when that probe ran (timezone-aware). Null until the first probe.

Both are DISTINCT from ``status`` (the deploy lifecycle enum pending|deploying|running|failed) — a
discovered app is never "deployed" by us, so its liveness is tracked separately. Nullable, no server
default, so every existing row reads null (unknown) until the worker fills it in.

No new tables. ``health_url`` already exists (added in 0014).

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-07
"""
import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("marketplace_services", sa.Column("health_status", sa.String(length=20), nullable=True))
    op.add_column(
        "marketplace_services",
        sa.Column("health_checked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("marketplace_services", "health_checked_at")
    op.drop_column("marketplace_services", "health_status")
