"""Terminology alignment: lifecycle stages, control statuses, evidence statuses

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-01

Aligns DB enum values with the finalized product terminology document
(product-terminology-2026-08-28.md):

Lifecycle stages:
  conformity   -> prod_ready  (conformity assessment is embedded in production
                                readiness, not a separate stage)
  post-market  -> service     (renamed "In Service")
  new: updated               (no data migration; existing rows won't use it yet)

Control/Requirement statuses:
  not_started      -> open
  in_implementation -> planned
  implemented      -> under_review
  effective        -> fulfilled

Evidence statuses:
  pending -> awaiting_review
"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- lifecycle ---
    op.drop_constraint("ck_ai_systems_lifecycle", "ai_systems")
    op.execute("UPDATE ai_systems SET lifecycle = 'prod_ready' WHERE lifecycle = 'conformity'")
    op.execute("UPDATE ai_systems SET lifecycle = 'service' WHERE lifecycle = 'post-market'")
    op.create_check_constraint(
        "ck_ai_systems_lifecycle",
        "ai_systems",
        "lifecycle IN ('development','testing','prod_ready','market','service','updated','decommissioned')",
    )

    # --- control statuses ---
    op.drop_constraint("ck_controls_status", "controls")
    op.execute("UPDATE controls SET status = 'open' WHERE status = 'not_started'")
    op.execute("UPDATE controls SET status = 'planned' WHERE status = 'in_implementation'")
    op.execute("UPDATE controls SET status = 'under_review' WHERE status = 'implemented'")
    op.execute("UPDATE controls SET status = 'fulfilled' WHERE status = 'effective'")
    op.create_check_constraint(
        "ck_controls_status",
        "controls",
        "status IN ('open','planned','under_review','fulfilled','ineffective','deactivated')",
    )

    # --- evidence statuses ---
    op.drop_constraint("ck_evidence_status", "evidence")
    op.execute("UPDATE evidence SET status = 'awaiting_review' WHERE status = 'pending'")
    op.create_check_constraint(
        "ck_evidence_status",
        "evidence",
        "status IN ('awaiting_review','under_review','approved','rejected','expired')",
    )


def downgrade() -> None:
    # --- evidence statuses ---
    op.drop_constraint("ck_evidence_status", "evidence")
    op.execute("UPDATE evidence SET status = 'pending' WHERE status = 'awaiting_review'")
    op.create_check_constraint(
        "ck_evidence_status",
        "evidence",
        "status IN ('pending','under_review','approved','rejected','expired')",
    )

    # --- control statuses ---
    op.drop_constraint("ck_controls_status", "controls")
    op.execute("UPDATE controls SET status = 'not_started' WHERE status = 'open'")
    op.execute("UPDATE controls SET status = 'in_implementation' WHERE status = 'planned'")
    op.execute("UPDATE controls SET status = 'implemented' WHERE status = 'under_review'")
    op.execute("UPDATE controls SET status = 'effective' WHERE status = 'fulfilled'")
    op.create_check_constraint(
        "ck_controls_status",
        "controls",
        "status IN ('not_started','planned','in_implementation','implemented','effective','ineffective','deactivated')",
    )

    # --- lifecycle ---
    op.drop_constraint("ck_ai_systems_lifecycle", "ai_systems")
    op.execute("UPDATE ai_systems SET lifecycle = 'conformity' WHERE lifecycle = 'prod_ready'")
    op.execute("UPDATE ai_systems SET lifecycle = 'post-market' WHERE lifecycle = 'service'")
    op.create_check_constraint(
        "ck_ai_systems_lifecycle",
        "ai_systems",
        "lifecycle IN ('development','testing','conformity','market','post-market','decommissioned')",
    )
