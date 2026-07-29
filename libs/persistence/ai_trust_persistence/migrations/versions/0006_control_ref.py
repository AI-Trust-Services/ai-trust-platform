"""Add control_ref slug to controls (carry-forward key for auto-generated controls)

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-28
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Stable slug ("{article_ref}:{slug}") for auto-generated controls. Nullable —
    # manually-created controls have no template slug. Non-unique — the same slug
    # recurs each assessment cycle and org-wide controls span multiple assessments.
    op.add_column("controls", sa.Column("control_ref", sa.String(100), nullable=True))
    op.create_index("ix_controls_control_ref", "controls", ["control_ref"])


def downgrade() -> None:
    op.drop_index("ix_controls_control_ref", table_name="controls")
    op.drop_column("controls", "control_ref")
