"""Add confirmed_by to assessments table."""

revision = "0040"
down_revision = "0039"

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column(
        "assessments",
        sa.Column("confirmed_by", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("assessments", "confirmed_by")
