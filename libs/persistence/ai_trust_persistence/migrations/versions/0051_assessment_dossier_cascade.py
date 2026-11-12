"""Assessment dossier: FKs → CASCADE, append-only trigger blocks UPDATE only (#366).

Migration 0050 created the dossier with ``ON DELETE RESTRICT`` FKs and a
``BEFORE UPDATE OR DELETE`` trigger. That made it impossible to delete or abort
an assessment once it had been opened: the dossier's RESTRICT FK blocked the
parent delete, so compliance ``/abort`` and ``/delete`` (and the registry
Replace flow that calls them) 500'd with a ForeignKeyViolationError.

Per the #366 design discussion: a deleted/aborted (stale) assessment should take
its dossier with it, while approved/historicized assessments are never deleted
(compliance blocks that at the app layer). So:
  - the three dossier FKs become ``ON DELETE CASCADE`` — a dossier (and its
    output layers) lives and dies with its assessment/system;
  - the append-only trigger now rejects only ``UPDATE`` — a captured dossier's
    CONTENTS are still immutable (the real audit guarantee), but the assessment
    lifecycle can remove the row via cascade.

Revision ID: 0051
Revises: 0050
Create Date: 2026-11-12
"""

from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None

# (table, constraint_name, column, ref_table, ref_column) — names are Postgres's
# default `{table}_{column}_fkey` from the inline ForeignKey()s in migration 0050.
_FKS = [
    (
        "assessment_dossiers",
        "assessment_dossiers_assessment_id_fkey",
        "assessment_id",
        "assessments",
        "id",
    ),
    (
        "assessment_dossiers",
        "assessment_dossiers_ai_system_id_fkey",
        "ai_system_id",
        "ai_systems",
        "id",
    ),
    (
        "assessment_dossier_outputs",
        "assessment_dossier_outputs_dossier_id_fkey",
        "dossier_id",
        "assessment_dossiers",
        "id",
    ),
]


def _set_fk_ondelete(ondelete: str) -> None:
    for table, name, col, ref_table, ref_col in _FKS:
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(
            name, table, ref_table, [col], [ref_col], ondelete=ondelete
        )


def _recreate_triggers(events: str) -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_assessment_dossiers_append_only "
        "ON assessment_dossiers;"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_assessment_dossier_outputs_append_only "
        "ON assessment_dossier_outputs;"
    )
    op.execute(
        f"""
        CREATE TRIGGER trg_assessment_dossiers_append_only
            BEFORE {events} ON assessment_dossiers
            FOR EACH ROW EXECUTE FUNCTION assessment_dossier_append_only();
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER trg_assessment_dossier_outputs_append_only
            BEFORE {events} ON assessment_dossier_outputs
            FOR EACH ROW EXECUTE FUNCTION assessment_dossier_append_only();
        """
    )


def upgrade() -> None:
    _set_fk_ondelete("CASCADE")
    _recreate_triggers("UPDATE")


def downgrade() -> None:
    _set_fk_ondelete("RESTRICT")
    _recreate_triggers("UPDATE OR DELETE")
