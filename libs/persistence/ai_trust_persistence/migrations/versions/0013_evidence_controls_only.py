"""Evidence: drop ai_system_id/assessment_id and evidence_obligations table.

Controls are the sole attachment point for evidence. Obligation context is
derived through evidence_controls → control_obligations → obligations.

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())

    for fk in inspector.get_foreign_keys("evidence"):
        if fk["referred_table"] in ("ai_systems", "assessments"):
            # fk["name"] is the auto-generated constraint name (e.g. "evidence_ai_system_id_fkey")
            # set by Postgres when 0003 created the table — we read it at runtime instead of hardcoding it
            op.drop_constraint(fk["name"], "evidence", type_="foreignkey")

    op.drop_index("ix_evidence_ai_system_id", table_name="evidence")
    op.drop_index("ix_evidence_assessment_id", table_name="evidence")
    op.drop_column("evidence", "ai_system_id")
    op.drop_column("evidence", "assessment_id")

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
