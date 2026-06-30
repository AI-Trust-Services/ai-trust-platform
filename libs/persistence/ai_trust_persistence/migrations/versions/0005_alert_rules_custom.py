"""add parameters and is_custom to alert_rules; seed model_diverged rule

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-29
"""
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

_rules_table = sa.table(
    "alert_rules",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("category", sa.String),
    sa.column("severity", sa.String),
    sa.column("description", sa.Text),
    sa.column("condition_type", sa.String),
    sa.column("threshold", sa.Float),
    sa.column("source", sa.String),
    sa.column("alert_type", sa.String),
    sa.column("enabled", sa.Boolean),
    sa.column("parameters", sa.Text),
    sa.column("is_custom", sa.Boolean),
    sa.column("created_at", sa.DateTime(timezone=True)),
)

NEW_RULES = [
    {
        "id": str(uuid.uuid4()),
        "name": "Model version changed",
        "category": "observability",
        "severity": "warning",
        "description": "A service has started using a model that was not seen in the previous evaluation window.",
        "condition_type": "model_diverged",
        "threshold": None,
        "source": "Live Signals",
        "alert_type": "event",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
]


def upgrade() -> None:
    op.add_column("alert_rules", sa.Column("parameters", sa.Text, nullable=True))
    op.add_column("alert_rules", sa.Column("is_custom", sa.Boolean, nullable=False, server_default="false"))

    now = datetime.now(timezone.utc)
    op.bulk_insert(_rules_table, [{**r, "created_at": now} for r in NEW_RULES])


def downgrade() -> None:
    op.execute("DELETE FROM alert_rules WHERE condition_type = 'model_diverged'")
    op.drop_column("alert_rules", "is_custom")
    op.drop_column("alert_rules", "parameters")
