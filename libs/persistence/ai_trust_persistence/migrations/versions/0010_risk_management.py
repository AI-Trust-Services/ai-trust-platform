"""Add risk_registers, risk_entries, misuse_scenarios, mitigation_measures, reassessment_triggers

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "risk_registers",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("ai_system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft", index=True),
        sa.Column("assessment_scope", sa.Text(), nullable=False, server_default=""),
        sa.Column("residual_risk_acceptable", sa.Boolean(), nullable=True),
        sa.Column("residual_risk_argument", sa.Text(), nullable=False, server_default=""),
        sa.Column("approver_username", sa.String(200), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_assessment_completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "risk_entries",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("register_id", sa.String(30), sa.ForeignKey("risk_registers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(100), nullable=False, server_default=""),
        sa.Column("article_9_step", sa.String(20), nullable=False, server_default="9(2)(a)"),
        sa.Column("risk_type", sa.String(20), nullable=False, server_default="known"),
        sa.Column("severity", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("likelihood", sa.String(20), nullable=False, server_default="possible"),
        sa.Column("status", sa.String(20), nullable=False, server_default="identified"),
        sa.Column("review_notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("affects_vulnerable_groups", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("vulnerable_groups", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("closure_justification", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(50), nullable=False, server_default="manual"),
        sa.Column("taxonomy_mappings", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "misuse_scenarios",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("risk_id", sa.String(30), sa.ForeignKey("risk_entries.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("actor", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("likelihood", sa.String(20), nullable=False, server_default="possible"),
        sa.Column("consequence", sa.Text(), nullable=False, server_default=""),
        sa.Column("vulnerable_group", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "mitigation_measures",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("risk_id", sa.String(30), sa.ForeignKey("risk_entries.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("hierarchy_level", sa.String(20), nullable=False),
        sa.Column("implementation_guidance", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
        sa.Column("assigned_to", sa.String(200), nullable=True),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("override_notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "reassessment_triggers",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("ai_system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("trigger_type", sa.String(50), nullable=False),
        sa.Column("trigger_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("triggered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("acknowledged", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("acknowledged_by", sa.String(200), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("new_register_id", sa.String(30), sa.ForeignKey("risk_registers.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("reassessment_triggers")
    op.drop_table("mitigation_measures")
    op.drop_table("misuse_scenarios")
    op.drop_table("risk_entries")
    op.drop_table("risk_registers")
