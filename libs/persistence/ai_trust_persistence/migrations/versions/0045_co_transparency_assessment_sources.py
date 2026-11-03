"""CO-issued transparency flag + persisted assessment source passages (#348)

- ai_systems.co_issued_transparency (boolean, default false): set when the
  compliance officer issues the "high + high_transparency" combo, so the Art.50
  transparency label persists independently of the inferred is_chatbot/
  generates_synthetic_content flags.
- ai_systems.assessment_sources (JSONB): the source passages (filename + page)
  that informed the single-page assessment prefill, captured in /open and
  surfaced (assessment-level) in the start page, confidence modal, and CO panel.

Revision ID: 0045
Revises: 0043
Create Date: 2026-11-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0045"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_systems",
        sa.Column(
            "co_issued_transparency",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "ai_systems",
        sa.Column("assessment_sources", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_systems", "assessment_sources")
    op.drop_column("ai_systems", "co_issued_transparency")
