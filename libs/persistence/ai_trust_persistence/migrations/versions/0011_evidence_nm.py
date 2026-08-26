"""Evidence N:M: replace ai_system_id/assessment_id FK columns with join tables

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New join tables
    op.create_table(
        "evidence_ai_systems",
        sa.Column("evidence_id", sa.String(30), sa.ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("ai_system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_evidence_ai_systems_ai_system_id", "evidence_ai_systems", ["ai_system_id"])

    op.create_table(
        "evidence_assessments",
        sa.Column("evidence_id", sa.String(30), sa.ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("assessment_id", sa.String(30), sa.ForeignKey("assessments.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_evidence_assessments_assessment_id", "evidence_assessments", ["assessment_id"])

    # Migrate existing 1:N links into the new join tables
    op.execute(
        "INSERT INTO evidence_ai_systems (evidence_id, ai_system_id) "
        "SELECT id, ai_system_id FROM evidence WHERE ai_system_id IS NOT NULL"
    )
    op.execute(
        "INSERT INTO evidence_assessments (evidence_id, assessment_id) "
        "SELECT id, assessment_id FROM evidence WHERE assessment_id IS NOT NULL"
    )

    # Drop old FK columns
    op.drop_index("ix_evidence_ai_system_id", table_name="evidence", if_exists=True)
    op.drop_index("ix_evidence_assessment_id", table_name="evidence", if_exists=True)
    op.drop_column("evidence", "ai_system_id")
    op.drop_column("evidence", "assessment_id")


def downgrade() -> None:
    # Re-add columns (nullable — N:M data cannot be losslessly reversed)
    op.add_column("evidence", sa.Column("ai_system_id", sa.String(20), sa.ForeignKey("ai_systems.id", ondelete="SET NULL"), nullable=True))
    op.add_column("evidence", sa.Column("assessment_id", sa.String(30), sa.ForeignKey("assessments.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_evidence_ai_system_id", "evidence", ["ai_system_id"])
    op.create_index("ix_evidence_assessment_id", "evidence", ["assessment_id"])

    # Drop join tables
    op.drop_index("ix_evidence_ai_systems_ai_system_id", table_name="evidence_ai_systems")
    op.drop_table("evidence_ai_systems")
    op.drop_index("ix_evidence_assessments_assessment_id", table_name="evidence_assessments")
    op.drop_table("evidence_assessments")
