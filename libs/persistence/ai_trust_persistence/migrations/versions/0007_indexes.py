"""Add missing indexes on M2M trailing columns and hot-path composite predicates

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-31

Without these indexes the following queries are full table scans:

  control_obligations  WHERE obligation_id = ?   (cascade on every control change)
  evidence_controls    WHERE control_id = ?       (cascade on every evidence approve/reject)
  evidence_obligations WHERE obligation_id = ?   (cascade on every evidence approve/reject)

  assessments          WHERE ai_system_id = ? AND status = ?   (cascade score recalc)
  obligations          WHERE assessment_id = ? AND status = ?  (cascade score recalc)

  evidence             WHERE validity_until = ?   (policy-checker-worker, runs every 10s)
  assessments          WHERE updated_at >= ?      (GET /assessments?updated_after=)
  obligations          WHERE article_ref = ?      (_prior_owners_by_ref on assessment create)
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # M2M reverse indexes — PK leading column doesn't cover these lookups
    op.create_index(
        "ix_control_obligations_obligation_id",
        "control_obligations",
        ["obligation_id"],
    )
    op.create_index(
        "ix_evidence_controls_control_id",
        "evidence_controls",
        ["control_id"],
    )
    op.create_index(
        "ix_evidence_obligations_obligation_id",
        "evidence_obligations",
        ["obligation_id"],
    )

    # Composite indexes covering both columns in hot-path two-column predicates
    op.create_index(
        "ix_assessments_system_status",
        "assessments",
        ["ai_system_id", "status"],
    )
    op.create_index(
        "ix_obligations_assessment_status",
        "obligations",
        ["assessment_id", "status"],
    )

    # Single-column misses
    op.create_index("ix_evidence_validity_until", "evidence", ["validity_until"])
    op.create_index("ix_assessments_updated_at", "assessments", ["updated_at"])
    op.create_index("ix_obligations_article_ref", "obligations", ["article_ref"])


def downgrade() -> None:
    op.drop_index("ix_obligations_article_ref", table_name="obligations")
    op.drop_index("ix_assessments_updated_at", table_name="assessments")
    op.drop_index("ix_evidence_validity_until", table_name="evidence")
    op.drop_index("ix_obligations_assessment_status", table_name="obligations")
    op.drop_index("ix_assessments_system_status", table_name="assessments")
    op.drop_index("ix_evidence_obligations_obligation_id", table_name="evidence_obligations")
    op.drop_index("ix_evidence_controls_control_id", table_name="evidence_controls")
    op.drop_index("ix_control_obligations_obligation_id", table_name="control_obligations")
