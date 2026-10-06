"""AI Test Bed: test_bed_runs log table

Single JSONB log table for test-bed runs and corrections. One row per run;
corrections stored as rows with kind='correction'. Flat top-level columns
(sample_id, role, prompt_revision, enabled_sources, model, knowledge_revision)
allow cheap filtering without digging into the payload JSONB.

Revision ID: 0036
Revises: 0035
Create Date: 2026-10-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "test_bed_runs",
        sa.Column("id", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("sample_id", sa.Text(), nullable=False),
        sa.Column("role", sa.String(40), nullable=False),
        sa.Column("prompt_revision", sa.Text(), nullable=True),
        sa.Column("enabled_sources", JSONB(), nullable=False),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("knowledge_revision", sa.Text(), nullable=True),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_test_bed_runs_sample_id", "test_bed_runs", ["sample_id"])


def downgrade() -> None:
    op.drop_index("ix_test_bed_runs_sample_id", table_name="test_bed_runs")
    op.drop_table("test_bed_runs")
