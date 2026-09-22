"""Requirement: drop requirement_obligations M2M, add obligation_id + assessment_id FK.

Each requirement now belongs to exactly one obligation (1:N).

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("requirements", sa.Column(
        "obligation_id", sa.String(30),
        sa.ForeignKey("obligations.id", ondelete="CASCADE"),
        nullable=True,
    ))
    op.add_column("requirements", sa.Column(
        "assessment_id", sa.String(30),
        sa.ForeignKey("assessments.id", ondelete="CASCADE"),
        nullable=True,
    ))
    op.create_index("ix_requirements_obligation_id", "requirements", ["obligation_id"])
    op.create_index("ix_requirements_assessment_id", "requirements", ["assessment_id"])

    # Backfill before drop: pick the lexicographically first obligation per requirement
    # (DISTINCT ON), then join obligations to get assessment_id in one pass.
    conn = op.get_context().connection
    conn.execute(text("""
        UPDATE requirements r
        SET obligation_id = ro.obligation_id,
            assessment_id = o.assessment_id
        FROM (
            SELECT DISTINCT ON (requirement_id) requirement_id, obligation_id
            FROM requirement_obligations
            ORDER BY requirement_id, obligation_id
        ) ro
        JOIN obligations o ON o.id = ro.obligation_id
        WHERE r.id = ro.requirement_id
    """))
    op.drop_table("requirement_obligations")


def downgrade() -> None:
    op.drop_index("ix_requirements_assessment_id", table_name="requirements")
    op.drop_index("ix_requirements_obligation_id", table_name="requirements")
    op.drop_column("requirements", "assessment_id")
    op.drop_column("requirements", "obligation_id")

    op.create_table(
        "requirement_obligations",
        sa.Column("requirement_id", sa.String(30), sa.ForeignKey("requirements.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("obligation_id", sa.String(30), sa.ForeignKey("obligations.id", ondelete="CASCADE"), primary_key=True),
    )
