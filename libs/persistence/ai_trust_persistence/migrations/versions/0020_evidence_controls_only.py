"""Evidence: drop ai_system_id/assessment_id and evidence_obligations table.

Controls are the sole attachment point for evidence.

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    evidence_cols = {col["name"] for col in inspector.get_columns("evidence")}
    evidence_indexes = {idx["name"] for idx in inspector.get_indexes("evidence")}
    existing_tables = set(inspector.get_table_names())

    for fk in inspector.get_foreign_keys("evidence"):
        if fk["referred_table"] in ("ai_systems", "assessments"):
            op.drop_constraint(fk["name"], "evidence", type_="foreignkey")

    if "ix_evidence_ai_system_id" in evidence_indexes:
        op.drop_index("ix_evidence_ai_system_id", table_name="evidence")
    if "ix_evidence_assessment_id" in evidence_indexes:
        op.drop_index("ix_evidence_assessment_id", table_name="evidence")
    if "ai_system_id" in evidence_cols:
        op.drop_column("evidence", "ai_system_id")
    if "assessment_id" in evidence_cols:
        op.drop_column("evidence", "assessment_id")

    if "evidence_obligations" in existing_tables:
        eo_indexes = {idx["name"] for idx in inspector.get_indexes("evidence_obligations")}
        if "ix_evidence_obligations_obligation_id" in eo_indexes:
            op.drop_index("ix_evidence_obligations_obligation_id", table_name="evidence_obligations")
        op.drop_table("evidence_obligations")


def downgrade() -> None:
    op.create_table(
        "evidence_obligations",
        sa.Column("evidence_id", sa.String(30), sa.ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("obligation_id", sa.String(30), sa.ForeignKey("obligations.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_evidence_obligations_obligation_id", "evidence_obligations", ["obligation_id"])

    op.add_column("evidence", sa.Column("ai_system_id", sa.String(20), nullable=True))
    op.add_column("evidence", sa.Column("assessment_id", sa.String(30), nullable=True))
    op.create_index("ix_evidence_ai_system_id", "evidence", ["ai_system_id"])
    op.create_index("ix_evidence_assessment_id", "evidence", ["assessment_id"])
