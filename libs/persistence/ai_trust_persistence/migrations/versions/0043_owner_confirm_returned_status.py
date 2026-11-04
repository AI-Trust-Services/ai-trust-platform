"""Owner-confirm tracking + `returned` status for the single-page assessment

Iteration 2 (#347):
- Adds ``question_states.confirmed_by`` so a question's confirmation records WHO
  confirmed it — the submit gate requires every question *owner*-confirmed, and a
  contributor confirming their assigned question is progress-only.
- Adds the ``returned`` status value to both the registry ``ck_ai_systems_workflow_status``
  and the compliance ``ck_assessments_status`` CHECK constraints. ``returned`` is the
  CO-bounce target (CO sends an assessment back to the owner); the reject action that
  sets it ships in iteration 3 (#348), but the enum value is added now so the status
  model is complete. (``locked`` is NOT a new value — it is the owner-facing label +
  read-only behaviour of the existing ``pending_review`` state.)

Revision ID: 0043
Revises: 0042
Create Date: 2026-11-03
"""

from alembic import op
import sqlalchemy as sa

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None

_WORKFLOW_WITH_RETURNED = (
    "draft",
    "business_pending",
    "technical_pending",
    "pending_review",
    "info_requested",
    "approved",
    "rejected",
    "returned",
)
_WORKFLOW_WITHOUT_RETURNED = _WORKFLOW_WITH_RETURNED[:-1]

_ASSESS_WITH_RETURNED = (
    "questionnaire_pending",
    "draft",
    "submitted",
    "under_review",
    "pending_review",
    "approved",
    "inactive",
    "returned",
)
_ASSESS_WITHOUT_RETURNED = _ASSESS_WITH_RETURNED[:-1]


def _wf(values: tuple[str, ...]) -> str:
    return "workflow_status IN (" + ", ".join(f"'{s}'" for s in values) + ")"


def _as(values: tuple[str, ...]) -> str:
    return "status IN (" + ", ".join(f"'{s}'" for s in values) + ")"


def upgrade() -> None:
    op.add_column(
        "question_states",
        sa.Column("confirmed_by", sa.String(200), nullable=True),
    )
    op.drop_constraint("ck_ai_systems_workflow_status", "ai_systems")
    op.create_check_constraint(
        "ck_ai_systems_workflow_status", "ai_systems", _wf(_WORKFLOW_WITH_RETURNED)
    )
    op.drop_constraint("ck_assessments_status", "assessments")
    op.create_check_constraint(
        "ck_assessments_status", "assessments", _as(_ASSESS_WITH_RETURNED)
    )


def downgrade() -> None:
    op.drop_constraint("ck_assessments_status", "assessments")
    op.create_check_constraint(
        "ck_assessments_status", "assessments", _as(_ASSESS_WITHOUT_RETURNED)
    )
    op.drop_constraint("ck_ai_systems_workflow_status", "ai_systems")
    op.create_check_constraint(
        "ck_ai_systems_workflow_status", "ai_systems", _wf(_WORKFLOW_WITHOUT_RETURNED)
    )
    op.drop_column("question_states", "confirmed_by")
