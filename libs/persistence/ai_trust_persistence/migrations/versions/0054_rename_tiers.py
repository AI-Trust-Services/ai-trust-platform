"""Rename tier values: minimal→minimal_no, limited→transparency

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-25

Aligns machine-readable tier values with the canonical product terminology
(product-terminology-final-2026-10-28.docx §2).
"""

from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop CHECK constraint before updating data, then recreate with new values.
    op.drop_constraint("ck_ai_systems_tier", "ai_systems")

    op.execute("UPDATE ai_systems SET tier = 'minimal_no' WHERE tier = 'minimal'")
    op.execute("UPDATE ai_systems SET tier = 'transparency' WHERE tier = 'limited'")

    # Also update any frozen tier snapshots on assessment rows.
    op.execute("UPDATE assessments SET tier = 'minimal_no' WHERE tier = 'minimal'")
    op.execute("UPDATE assessments SET tier = 'transparency' WHERE tier = 'limited'")

    op.create_check_constraint(
        "ck_ai_systems_tier",
        "ai_systems",
        "tier IN ('prohibited', 'gpai-systemic', 'gpai-standard', 'high', 'transparency', 'minimal_no', 'pending')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_systems_tier", "ai_systems")

    op.execute("UPDATE ai_systems SET tier = 'minimal' WHERE tier = 'minimal_no'")
    op.execute("UPDATE ai_systems SET tier = 'limited' WHERE tier = 'transparency'")

    op.execute("UPDATE assessments SET tier = 'minimal' WHERE tier = 'minimal_no'")
    op.execute("UPDATE assessments SET tier = 'limited' WHERE tier = 'transparency'")

    op.create_check_constraint(
        "ck_ai_systems_tier",
        "ai_systems",
        "tier IN ('prohibited', 'gpai-systemic', 'gpai-standard', 'high', 'limited', 'minimal', 'pending')",
    )
