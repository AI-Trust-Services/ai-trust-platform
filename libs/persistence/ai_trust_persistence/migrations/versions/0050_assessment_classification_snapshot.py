"""Per-cycle EU AI Act classification snapshot columns on assessments

The single-page assessment flow snapshots the classification that THIS cycle was
issued at onto the assessment row, so a historical read-only "View results" shows
the cycle exactly as approved — independent of later edits to the mutable AISystem
row. Columns added by this migration back the fields on the Assessment model, set
by issue_classification.

Revision ID: 0050
Revises: 0049
Create Date: 2026-11-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assessments", sa.Column("tier", sa.String(length=30), nullable=True))
    op.add_column("assessments", sa.Column("basis", sa.Text(), nullable=True))
    op.add_column(
        "assessments", sa.Column("annex_iii_area", sa.Integer(), nullable=True)
    )
    op.add_column(
        "assessments", sa.Column("org_role", sa.String(length=30), nullable=True)
    )
    op.add_column(
        "assessments", sa.Column("co_issued_transparency", sa.Boolean(), nullable=True)
    )
    op.add_column("assessments", sa.Column("is_chatbot", sa.Boolean(), nullable=True))
    op.add_column(
        "assessments",
        sa.Column("generates_synthetic_content", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "assessments", sa.Column("assessment_sources", JSONB(), nullable=True)
    )
    op.add_column(
        "assessments", sa.Column("classification_rationale", JSONB(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("assessments", "classification_rationale")
    op.drop_column("assessments", "assessment_sources")
    op.drop_column("assessments", "generates_synthetic_content")
    op.drop_column("assessments", "is_chatbot")
    op.drop_column("assessments", "co_issued_transparency")
    op.drop_column("assessments", "org_role")
    op.drop_column("assessments", "annex_iii_area")
    op.drop_column("assessments", "basis")
    op.drop_column("assessments", "tier")
