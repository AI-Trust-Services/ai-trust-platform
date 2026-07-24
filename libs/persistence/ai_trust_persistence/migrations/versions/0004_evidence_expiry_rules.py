"""Add evidence expiry alert rules (evidence_expired, evidence_expiring_30d, evidence_expiring_7d)

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-21
"""
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

_rules_table = sa.table(
    "alert_rules",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("category", sa.String),
    sa.column("severity", sa.String),
    sa.column("description", sa.String),
    sa.column("condition_type", sa.String),
    sa.column("threshold", sa.Float),
    sa.column("source", sa.String),
    sa.column("alert_type", sa.String),
    sa.column("enabled", sa.Boolean),
    sa.column("parameters", sa.Text),
    sa.column("is_custom", sa.Boolean),
    sa.column("created_at", sa.DateTime(timezone=True)),
)

_NEW_RULES = [
    {
        "id": str(uuid.uuid4()),
        "name": "Evidence expired",
        "category": "compliance",
        "severity": "error",
        "description": "An approved evidence item has passed its validity date. The linked control and obligation status will be updated automatically.",
        "condition_type": "evidence_expired",
        "threshold": None,
        "source": "Compliance",
        "alert_type": "event",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Evidence expiring in 30 days",
        "category": "compliance",
        "severity": "warning",
        "description": "An approved evidence item will expire within 30 days. Upload a new version before it expires to maintain compliance.",
        "condition_type": "evidence_expiring_30d",
        "threshold": 30.0,
        "source": "Compliance",
        "alert_type": "event",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Evidence expiring in 7 days",
        "category": "compliance",
        "severity": "error",
        "description": "An approved evidence item will expire within 7 days. Immediate renewal required to avoid compliance gaps.",
        "condition_type": "evidence_expiring_7d",
        "threshold": 7.0,
        "source": "Compliance",
        "alert_type": "event",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
]


def upgrade() -> None:
    now = datetime.now(timezone.utc)
    op.bulk_insert(_rules_table, [{**r, "created_at": now} for r in _NEW_RULES])


def downgrade() -> None:
    op.execute(
        "DELETE FROM alert_rules WHERE condition_type IN "
        "('evidence_expired', 'evidence_expiring_30d', 'evidence_expiring_7d')"
    )
