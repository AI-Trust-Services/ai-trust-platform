"""Add confirmed_by + per-cycle classification snapshot to assessments table.

confirmed_by records who approved. The classification-snapshot columns (tier,
basis, annex_iii_area, org_role, co_issued_transparency, assessment_sources,
classification_rationale) freeze the single-page assessment's issued
classification onto the per-cycle Assessment row — the live classification lives
on the AISystem row and is overwritten each re-assessment, so these let a
historical "View results" show the cycle exactly as approved.
"""

revision = "0040"
down_revision = "0039"

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


def upgrade() -> None:
    op.add_column(
        "assessments",
        sa.Column("confirmed_by", sa.String(100), nullable=True),
    )
    op.add_column("assessments", sa.Column("tier", sa.String(30), nullable=True))
    op.add_column("assessments", sa.Column("basis", sa.Text(), nullable=True))
    op.add_column(
        "assessments", sa.Column("annex_iii_area", sa.Integer(), nullable=True)
    )
    op.add_column("assessments", sa.Column("org_role", sa.String(30), nullable=True))
    op.add_column(
        "assessments", sa.Column("co_issued_transparency", sa.Boolean(), nullable=True)
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
    op.drop_column("assessments", "co_issued_transparency")
    op.drop_column("assessments", "org_role")
    op.drop_column("assessments", "annex_iii_area")
    op.drop_column("assessments", "basis")
    op.drop_column("assessments", "tier")
    op.drop_column("assessments", "confirmed_by")
