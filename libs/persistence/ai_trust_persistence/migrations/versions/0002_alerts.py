"""Alerts tables: alert_rules (+ seed 8 default rules), service_model_baselines

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-16
"""
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
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

_SEED_RULES = [
    {
        "id": str(uuid.uuid4()),
        "name": "Prohibited system registered",
        "category": "risk",
        "severity": "error",
        "description": "A system classified as prohibited under EU AI Act Art. 5 has been registered. Immediate review required.",
        "condition_type": "prohibited_exists",
        "threshold": None,
        "source": "AI System Registry",
        "alert_type": "event",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Average compliance below threshold",
        "category": "compliance",
        "severity": "warning",
        "description": "The average compliance score across all registered AI systems has dropped below 70%.",
        "condition_type": "avg_compliance_below",
        "threshold": 70.0,
        "source": "AI System Registry",
        "alert_type": "threshold",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
    {
        "id": str(uuid.uuid4()),
        "name": "High-risk system on market with low compliance",
        "category": "compliance",
        "severity": "error",
        "description": "One or more high-risk AI systems that are on market have a compliance score below 50%. These require immediate attention.",
        "condition_type": "high_risk_on_market_low_compliance",
        "threshold": 50.0,
        "source": "AI System Registry",
        "alert_type": "threshold",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
    {
        "id": str(uuid.uuid4()),
        "name": "No inference signals received",
        "category": "observability",
        "severity": "warning",
        "description": "No AI inference signals have been received in the last 30 minutes. The monitoring pipeline may be down or no AI systems are active.",
        "condition_type": "no_signals",
        "threshold": 30.0,
        "source": "Live Signals",
        "alert_type": "threshold",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
    {
        "id": str(uuid.uuid4()),
        "name": "High average inference latency",
        "category": "observability",
        "severity": "warning",
        "description": "Average inference latency over the last hour exceeds 500ms. AI system performance may be degraded.",
        "condition_type": "high_latency",
        "threshold": 500.0,
        "source": "Live Signals",
        "alert_type": "threshold",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
    {
        "id": str(uuid.uuid4()),
        "name": "System on market without model card",
        "category": "compliance",
        "severity": "warning",
        "description": "One or more AI systems that are on market or post-market have no model card linked. Model documentation is required under EU AI Act Art. 11.",
        "condition_type": "market_system_no_model_card",
        "threshold": None,
        "source": "AI System Registry",
        "alert_type": "threshold",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
    {
        "id": str(uuid.uuid4()),
        "name": "GPAI system with no compliance score",
        "category": "risk",
        "severity": "warning",
        "description": "One or more General Purpose AI systems have a compliance score of 0. GPAI systems require documentation and compliance assessment under EU AI Act Art. 53.",
        "condition_type": "gpai_no_compliance",
        "threshold": None,
        "source": "AI System Registry",
        "alert_type": "threshold",
        "enabled": True,
        "parameters": None,
        "is_custom": False,
    },
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
    op.create_table(
        "alert_rules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("condition_type", sa.String(100), nullable=False),
        sa.Column("threshold", sa.Float, nullable=True),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("alert_type", sa.String(20), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("parameters", sa.Text, nullable=True),
        sa.Column("is_custom", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_alert_rules_enabled", "alert_rules", ["enabled"])
    op.create_index("ix_alert_rules_category", "alert_rules", ["category"])

    op.create_table(
        "service_model_baselines",
        sa.Column("service_name", sa.String(200), primary_key=True),
        sa.Column("model_name", sa.String(200), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    )

    now = datetime.now(timezone.utc)
    op.bulk_insert(_rules_table, [{**r, "created_at": now} for r in _SEED_RULES])


def downgrade() -> None:
    op.drop_table("service_model_baselines")
    op.drop_index("ix_alert_rules_category", "alert_rules")
    op.drop_index("ix_alert_rules_enabled", "alert_rules")
    op.drop_table("alert_rules")
