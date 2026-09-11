"""Control: drop control_obligations M2M, add obligation_id + assessment_id FK.

Each control now belongs to exactly one obligation (1:N).

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "control_obligations" in existing_tables:
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

    # Remove the now-redundant ai_system_id FK on controls (was nullable/org-wide).
    # ai_system_id is kept for evidence filtering (denormalized from obligation).
    controls_cols = {col["name"] for col in inspector.get_columns("controls")}
    if "ai_system_id" not in controls_cols:
        op.add_column("controls", sa.Column(
            "ai_system_id", sa.String(20),
            sa.ForeignKey("ai_systems.id", ondelete="SET NULL"),
            nullable=True,
        ))
        op.create_index("ix_controls_ai_system_id", "controls", ["ai_system_id"])


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
