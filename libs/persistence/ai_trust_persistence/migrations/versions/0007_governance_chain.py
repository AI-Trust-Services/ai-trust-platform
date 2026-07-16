"""create governance chain tables (frameworks, assessments, obligations,
controls, evidence) and seed frameworks

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-13
"""
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

SEED_FRAMEWORKS = [
    {
        "id": "FRM-EU-AI-ACT",
        "name": "EU AI Act",
        "version": "2024 (in force Aug 2026)",
        "description": "EU Regulation on Artificial Intelligence. Risk-tiered obligations for providers and deployers of AI systems.",
        "enabled": True,
    },
    {
        "id": "FRM-NIST-AI-RMF",
        "name": "NIST AI RMF",
        "version": "1.0 (2023)",
        "description": "NIST AI Risk Management Framework. Voluntary framework organised around GOVERN, MAP, MEASURE, and MANAGE functions.",
        "enabled": True,
    },
    {
        "id": "FRM-ISO-42001",
        "name": "ISO/IEC 42001",
        "version": "2023",
        "description": "International standard for AI management systems (AIMS). Requirements for establishing, implementing, and improving an AI management system.",
        "enabled": True,
    },
]

_frameworks_table = sa.table(
    "frameworks",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("version", sa.String),
    sa.column("description", sa.Text),
    sa.column("enabled", sa.Boolean),
    sa.column("created_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    op.create_table(
        "frameworks",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("version", sa.String(50), nullable=False, server_default=""),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "assessments",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("ai_system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("framework_id", sa.String(30), sa.ForeignKey("frameworks.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("type", sa.String(50), nullable=False, server_default="compliance"),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("score", sa.Float, nullable=True),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_assessments_ai_system_id", "assessments", ["ai_system_id"])
    op.create_index("ix_assessments_framework_id", "assessments", ["framework_id"])
    op.create_index("ix_assessments_status", "assessments", ["status"])

    op.create_table(
        "obligations",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("assessment_id", sa.String(30), sa.ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ai_system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("framework_id", sa.String(30), sa.ForeignKey("frameworks.id"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("article_ref", sa.String(50), nullable=False, server_default=""),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default="applicable"),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column("owner", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_obligations_assessment_id", "obligations", ["assessment_id"])
    op.create_index("ix_obligations_ai_system_id", "obligations", ["ai_system_id"])
    op.create_index("ix_obligations_status", "obligations", ["status"])

    op.create_table(
        "controls",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("ai_system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("category", sa.String(50), nullable=False, server_default="general"),
        sa.Column("status", sa.String(30), nullable=False, server_default="not_started"),
        sa.Column("effectiveness", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("owner", sa.String(200), nullable=False, server_default=""),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_controls_ai_system_id", "controls", ["ai_system_id"])
    op.create_index("ix_controls_status", "controls", ["status"])

    op.create_table(
        "control_obligations",
        sa.Column("control_id", sa.String(30), sa.ForeignKey("controls.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("obligation_id", sa.String(30), sa.ForeignKey("obligations.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "evidence",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("ai_system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assessment_id", sa.String(30), sa.ForeignKey("assessments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("evidence_type", sa.String(50), nullable=False, server_default="document"),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("validity_from", sa.Date, nullable=True),
        sa.Column("validity_until", sa.Date, nullable=True),
        sa.Column("file_path", sa.String(500), nullable=False, server_default=""),
        sa.Column("file_name", sa.String(300), nullable=False, server_default=""),
        sa.Column("file_size", sa.Integer, nullable=False, server_default="0"),
        sa.Column("mime_type", sa.String(100), nullable=False, server_default=""),
        sa.Column("uploaded_by", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_evidence_ai_system_id", "evidence", ["ai_system_id"])
    op.create_index("ix_evidence_assessment_id", "evidence", ["assessment_id"])
    op.create_index("ix_evidence_status", "evidence", ["status"])

    op.create_table(
        "evidence_controls",
        sa.Column("evidence_id", sa.String(30), sa.ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("control_id", sa.String(30), sa.ForeignKey("controls.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "evidence_obligations",
        sa.Column("evidence_id", sa.String(30), sa.ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("obligation_id", sa.String(30), sa.ForeignKey("obligations.id", ondelete="CASCADE"), primary_key=True),
    )

    now = datetime.now(timezone.utc)
    op.bulk_insert(_frameworks_table, [{**f, "created_at": now} for f in SEED_FRAMEWORKS])


def downgrade() -> None:
    op.drop_table("evidence_obligations")
    op.drop_table("evidence_controls")
    op.drop_index("ix_evidence_status", "evidence")
    op.drop_index("ix_evidence_assessment_id", "evidence")
    op.drop_index("ix_evidence_ai_system_id", "evidence")
    op.drop_table("evidence")
    op.drop_table("control_obligations")
    op.drop_index("ix_controls_status", "controls")
    op.drop_index("ix_controls_ai_system_id", "controls")
    op.drop_table("controls")
    op.drop_index("ix_obligations_status", "obligations")
    op.drop_index("ix_obligations_ai_system_id", "obligations")
    op.drop_index("ix_obligations_assessment_id", "obligations")
    op.drop_table("obligations")
    op.drop_index("ix_assessments_status", "assessments")
    op.drop_index("ix_assessments_framework_id", "assessments")
    op.drop_index("ix_assessments_ai_system_id", "assessments")
    op.drop_table("assessments")
    op.drop_table("frameworks")
