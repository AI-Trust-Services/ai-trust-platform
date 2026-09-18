"""Rename controls table to requirements (and related tables/columns/constraints)

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-14
"""
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop FK constraints before renaming (Postgres requires this)
    op.drop_constraint("control_obligations_control_id_fkey", "control_obligations", type_="foreignkey")
    op.drop_constraint("evidence_controls_control_id_fkey", "evidence_controls", type_="foreignkey")

    # Rename tables
    op.rename_table("controls", "requirements")
    op.rename_table("control_obligations", "requirement_obligations")
    op.rename_table("evidence_controls", "evidence_requirements")

    # Rename columns
    op.alter_column("requirements", "control_ref", new_column_name="requirement_ref")
    op.alter_column("requirement_obligations", "control_id", new_column_name="requirement_id")
    op.alter_column("evidence_requirements", "control_id", new_column_name="requirement_id")

    # Rename CHECK constraint on status
    op.execute("ALTER TABLE requirements RENAME CONSTRAINT ck_controls_status TO ck_requirements_status")

    # Rename M2M reverse indexes (Postgres preserves index names through table renames)
    op.execute("ALTER INDEX IF EXISTS ix_control_obligations_obligation_id RENAME TO ix_requirement_obligations_obligation_id")
    op.execute("ALTER INDEX IF EXISTS ix_evidence_controls_control_id RENAME TO ix_evidence_requirements_requirement_id")

    # Recreate FK constraints with new names and pointing to renamed table/columns
    op.create_foreign_key(
        "requirement_obligations_requirement_id_fkey",
        "requirement_obligations", "requirements",
        ["requirement_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "evidence_requirements_requirement_id_fkey",
        "evidence_requirements", "requirements",
        ["requirement_id"], ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("evidence_requirements_requirement_id_fkey", "evidence_requirements", type_="foreignkey")
    op.drop_constraint("requirement_obligations_requirement_id_fkey", "requirement_obligations", type_="foreignkey")

    op.execute("ALTER TABLE requirements RENAME CONSTRAINT ck_requirements_status TO ck_controls_status")

    op.execute("ALTER INDEX IF EXISTS ix_requirement_obligations_obligation_id RENAME TO ix_control_obligations_obligation_id")
    op.execute("ALTER INDEX IF EXISTS ix_evidence_requirements_requirement_id RENAME TO ix_evidence_controls_control_id")

    op.alter_column("evidence_requirements", "requirement_id", new_column_name="control_id")
    op.alter_column("requirement_obligations", "requirement_id", new_column_name="control_id")
    op.alter_column("requirements", "requirement_ref", new_column_name="control_ref")

    op.rename_table("evidence_requirements", "evidence_controls")
    op.rename_table("requirement_obligations", "control_obligations")
    op.rename_table("requirements", "controls")

    op.create_foreign_key(
        "evidence_controls_control_id_fkey",
        "evidence_controls", "controls",
        ["control_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "control_obligations_control_id_fkey",
        "control_obligations", "controls",
        ["control_id"], ["id"],
        ondelete="CASCADE",
    )
