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
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None

# Columns were previously added by migration 0040 in some deployments before
# 0040 was trimmed to only add confirmed_by. Skip any that already exist so
# this migration is safe on both old and fresh databases.
_COLUMNS = [
    ("tier", sa.String(length=30)),
    ("basis", sa.Text()),
    ("annex_iii_area", sa.Integer()),
    ("org_role", sa.String(length=30)),
    ("co_issued_transparency", sa.Boolean()),
    ("is_chatbot", sa.Boolean()),
    ("generates_synthetic_content", sa.Boolean()),
    ("assessment_sources", JSONB()),
    ("classification_rationale", JSONB()),
]


def upgrade() -> None:
    bind = op.get_bind()
    existing = {col["name"] for col in inspect(bind).get_columns("assessments")}
    for col_name, col_type in _COLUMNS:
        if col_name not in existing:
            op.add_column("assessments", sa.Column(col_name, col_type, nullable=True))


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
