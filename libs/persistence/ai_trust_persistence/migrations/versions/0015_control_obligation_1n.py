"""Control: drop control_obligations M2M, add obligation_id + assessment_id FK.

Each control now belongs to exactly one obligation (1:N).

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-10
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("control_obligations")

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
