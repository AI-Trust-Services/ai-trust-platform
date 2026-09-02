"""Add registration_mode and registration_documents to ai_systems

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-31

Adds the top-level registration mode discriminator (ai / manual_questionnaire /
full_manual) and a JSONB column holding supporting-document metadata for the
full-manual override path. Existing rows backfill to ``registration_mode="ai"``
via ``server_default`` — every prior system used the AI/owner questionnaire flow,
so "ai" is the correct retroactive value.

No DDL for ``workflow_status``, ``system_workflow_steps.step`` or
``classification_rationale`` — all are plain VARCHAR(30)/JSONB with room for the
new ``info_requested`` status, the ``sub_*``/``info_*`` step values, and the
extended ``{flags, confidence, reasoning, missing_info}`` rationale shape.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_systems",
        sa.Column("registration_mode", sa.String(30), nullable=False, server_default="ai"),
    )
    op.add_column(
        "ai_systems",
        sa.Column("registration_documents", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_systems", "registration_documents")
    op.drop_column("ai_systems", "registration_mode")
