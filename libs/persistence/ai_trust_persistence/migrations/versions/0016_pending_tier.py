"""Add 'pending' to ck_ai_systems_tier CHECK constraint

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-03

Systems registered with only a name+description start with tier='pending' until
risk classification is completed in Assessments.
"""
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_ai_systems_tier", "ai_systems")
    op.create_check_constraint(
        "ck_ai_systems_tier",
        "ai_systems",
        "tier IN ('prohibited', 'gpai-systemic', 'gpai-standard', 'high', 'limited', 'minimal', 'pending')",
    )
    op.drop_constraint("ck_assessments_status", "assessments")
    op.create_check_constraint(
        "ck_assessments_status",
        "assessments",
        "status IN ('questionnaire_pending', 'draft', 'submitted', 'under_review', 'pending_review', 'approved')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_systems_tier", "ai_systems")
    op.create_check_constraint(
        "ck_ai_systems_tier",
        "ai_systems",
        "tier IN ('prohibited', 'gpai-systemic', 'gpai-standard', 'high', 'limited', 'minimal')",
    )
    op.drop_constraint("ck_assessments_status", "assessments")
    op.create_check_constraint(
        "ck_assessments_status",
        "assessments",
        "status IN ('draft', 'submitted', 'under_review', 'approved')",
    )
