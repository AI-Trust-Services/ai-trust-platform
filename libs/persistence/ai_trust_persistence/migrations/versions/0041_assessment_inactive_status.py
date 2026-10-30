"""Add 'inactive' to ck_assessments_status CHECK constraint."""

revision = "0041"
down_revision = "0040"

from alembic import op


def upgrade() -> None:
    op.drop_constraint("ck_assessments_status", "assessments")
    op.create_check_constraint(
        "ck_assessments_status",
        "assessments",
        "status IN ('questionnaire_pending', 'draft', 'submitted', 'under_review', 'pending_review', 'approved', 'inactive')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_assessments_status", "assessments")
    op.create_check_constraint(
        "ck_assessments_status",
        "assessments",
        "status IN ('questionnaire_pending', 'draft', 'submitted', 'under_review', 'pending_review', 'approved')",
    )
