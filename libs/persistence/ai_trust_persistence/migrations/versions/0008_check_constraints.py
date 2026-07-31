"""Add CHECK constraints for status, tier, and lifecycle columns

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-31

Enforces the same valid-value sets that the Pydantic schemas validate at the
API layer, but now at the storage layer. Any write — whether from the app,
a migration, or a direct SQL statement — that uses an unlisted value is
rejected by Postgres before the row is written.

Valid values mirror the VALID_* frozensets in:
  compliance/backend/app/schemas/assessment.py
  compliance/backend/app/schemas/obligation.py
  compliance/backend/app/schemas/control.py
  compliance/backend/app/schemas/evidence.py  (implicit from router logic)
  ai-system-registry/backend/app/classifier.py  (tier)
  ai-system-registry/backend/app/schemas/ai_system.py  (lifecycle)

Note: a "approved evidence must have validity_until" constraint was considered
but not added — some evidence types (policies, architecture decisions) are
legitimately evergreen. That is an application-layer concern, not a DB invariant.
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_assessments_status",
        "assessments",
        "status IN ('draft', 'submitted', 'under_review', 'approved')",
    )
    op.create_check_constraint(
        "ck_obligations_status",
        "obligations",
        "status IN ('applicable', 'in_progress', 'fulfilled', 'not_applicable', 'overdue')",
    )
    op.create_check_constraint(
        "ck_controls_status",
        "controls",
        "status IN ('not_started', 'planned', 'in_implementation', 'implemented', "
        "           'under_review', 'effective', 'ineffective', 'deactivated')",
    )
    op.create_check_constraint(
        "ck_evidence_status",
        "evidence",
        "status IN ('pending', 'approved', 'rejected', 'expired')",
    )
    op.create_check_constraint(
        "ck_ai_systems_tier",
        "ai_systems",
        "tier IN ('prohibited', 'gpai-systemic', 'gpai-standard', 'high', 'limited', 'minimal')",
    )
    op.create_check_constraint(
        "ck_ai_systems_lifecycle",
        "ai_systems",
        "lifecycle IN ('development', 'testing', 'conformity', 'market', 'post-market', 'decommissioned')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_systems_lifecycle", "ai_systems")
    op.drop_constraint("ck_ai_systems_tier", "ai_systems")
    op.drop_constraint("ck_evidence_status", "evidence")
    op.drop_constraint("ck_controls_status", "controls")
    op.drop_constraint("ck_obligations_status", "obligations")
    op.drop_constraint("ck_assessments_status", "assessments")
