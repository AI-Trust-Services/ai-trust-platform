"""Control: drop control_obligations M2M, add obligation_id + assessment_id FK.

Each control now belongs to exactly one obligation (1:N).

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("controls", sa.Column(
        "obligation_id", sa.String(30),
        sa.ForeignKey("obligations.id", ondelete="CASCADE"),
        nullable=True,
    ))
    op.add_column("controls", sa.Column(
        "assessment_id", sa.String(30),
        sa.ForeignKey("assessments.id", ondelete="CASCADE"),
        nullable=True,
    ))
    op.create_index("ix_controls_obligation_id", "controls", ["obligation_id"])
    op.create_index("ix_controls_assessment_id", "controls", ["assessment_id"])

    # Backfill before drop: pick the lexicographically first obligation per control
    # (DISTINCT ON), then join obligations to get assessment_id in one pass.
    conn = op.get_context().connection
    conn.execute(text("""
        UPDATE controls c
        SET obligation_id = co.obligation_id,
            assessment_id = o.assessment_id
        FROM (
            SELECT DISTINCT ON (control_id) control_id, obligation_id
            FROM control_obligations
            ORDER BY control_id, obligation_id
        ) co
        JOIN obligations o ON o.id = co.obligation_id
        WHERE c.id = co.control_id
    """))
    op.drop_table("control_obligations")


def downgrade() -> None:
    op.drop_index("ix_controls_assessment_id", table_name="controls")
    op.drop_index("ix_controls_obligation_id", table_name="controls")
    op.drop_column("controls", "assessment_id")
    op.drop_column("controls", "obligation_id")

    op.create_table(
        "control_obligations",
        sa.Column("control_id", sa.String(30), sa.ForeignKey("controls.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("obligation_id", sa.String(30), sa.ForeignKey("obligations.id", ondelete="CASCADE"), primary_key=True),
    )
