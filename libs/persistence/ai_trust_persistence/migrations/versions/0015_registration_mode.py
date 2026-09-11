"""Add registration_mode and registration_documents to ai_systems

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-31

Adds the top-level registration mode discriminator (ai / manual_questionnaire /
full_manual) and a JSONB column holding supporting-document metadata for the
full-manual override path. Existing rows backfill to ``registration_mode="ai"``
via ``server_default`` — every prior system used the AI/owner questionnaire flow,
so "ai" is the correct retroactive value.

No DDL for ``system_workflow_steps.step`` or ``classification_rationale`` — both are
plain VARCHAR(30)/JSONB with room for the new ``sub_*``/``info_*`` step values and the
extended ``{flags, confidence, reasoning, missing_info}`` rationale shape.

``workflow_status`` gains a CHECK constraint here, since this migration introduces the
``business_pending``/``technical_pending``/``info_requested`` states — a typo in any
transition (e.g. ``"busines_pending"``) is now rejected at the DB layer rather than
surfacing only when the state machine reads the value. Mirrors ``ck_ai_systems_tier``.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

_WORKFLOW_STATUSES = (
    "draft", "business_pending", "technical_pending",
    "pending_review", "info_requested", "approved", "rejected",
)


def upgrade() -> None:
    op.add_column(
        "ai_systems",
        sa.Column("registration_mode", sa.String(30), nullable=False, server_default="ai"),
    )
    op.add_column(
        "ai_systems",
        sa.Column("registration_documents", postgresql.JSONB(), nullable=True),
    )
    op.create_check_constraint(
        "ck_ai_systems_workflow_status",
        "ai_systems",
        "workflow_status IN (" + ", ".join(f"'{s}'" for s in _WORKFLOW_STATUSES) + ")",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_systems_workflow_status", "ai_systems")
    op.drop_column("ai_systems", "registration_documents")
    op.drop_column("ai_systems", "registration_mode")
