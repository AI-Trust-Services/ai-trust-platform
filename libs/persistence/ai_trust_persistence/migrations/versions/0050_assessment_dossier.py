"""Assessment dossier — append-only, immutable per-run snapshot (#366).

Two tables:
  assessment_dossiers         — frozen inputs/config/prompts, 1 row per cycle,
                                INSERTed at assessment start.
  assessment_dossier_outputs  — append-only output layers (``ai`` / future
                                ``user_confirmed`` for #370), 1 row per layer.

Both are **append-only**: a BEFORE UPDATE OR DELETE trigger rejects every
mutation, so once a row is written it can never change or be removed — the core
audit guarantee of #366 (prevention, not after-the-fact detection).
``UNIQUE(dossier_id, layer)`` makes each output layer write-once, so the AI
layer can never be overwritten by the user-confirmed layer (#370). FKs are
RESTRICT so an assessment/system with a dossier cannot be deleted out from under
it. TRUNCATE (test conftest) is not a row-level DELETE, so it bypasses the
trigger and tests still reset cleanly.

Revision ID: 0050
Revises: 0049
Create Date: 2026-11-10
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assessment_dossiers",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column(
            "assessment_id",
            sa.String(30),
            sa.ForeignKey("assessments.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "ai_system_id",
            sa.String(20),
            sa.ForeignKey("ai_systems.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("inputs", JSONB, nullable=False),
        sa.Column("config_snapshot", JSONB, nullable=False),
        sa.Column("prompt_snapshot", JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_unique_constraint(
        "uq_assessment_dossier_assessment",
        "assessment_dossiers",
        ["assessment_id"],
    )
    op.create_index(
        "ix_assessment_dossiers_ai_system_id",
        "assessment_dossiers",
        ["ai_system_id"],
    )

    op.create_table(
        "assessment_dossier_outputs",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column(
            "dossier_id",
            sa.String(30),
            sa.ForeignKey("assessment_dossiers.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("layer", sa.String(30), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_unique_constraint(
        "uq_dossier_output_layer",
        "assessment_dossier_outputs",
        ["dossier_id", "layer"],
    )
    op.create_index(
        "ix_assessment_dossier_outputs_dossier_id",
        "assessment_dossier_outputs",
        ["dossier_id"],
    )

    # Append-only enforcement: reject every UPDATE and DELETE on both tables.
    # Once a row is INSERTed it can never change or be removed — the audit
    # guarantee of #366. TRUNCATE fires no row-level trigger, so the test
    # conftest's TRUNCATE ... CASCADE still resets these tables.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION assessment_dossier_append_only()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION
                'assessment dossiers are append-only: % on % is not allowed',
                TG_OP, TG_TABLE_NAME;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_assessment_dossiers_append_only
            BEFORE UPDATE OR DELETE ON assessment_dossiers
            FOR EACH ROW EXECUTE FUNCTION assessment_dossier_append_only();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_assessment_dossier_outputs_append_only
            BEFORE UPDATE OR DELETE ON assessment_dossier_outputs
            FOR EACH ROW EXECUTE FUNCTION assessment_dossier_append_only();
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_assessment_dossier_outputs_append_only "
        "ON assessment_dossier_outputs;"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_assessment_dossiers_append_only "
        "ON assessment_dossiers;"
    )
    op.execute("DROP FUNCTION IF EXISTS assessment_dossier_append_only();")
    op.drop_index(
        "ix_assessment_dossier_outputs_dossier_id",
        table_name="assessment_dossier_outputs",
    )
    op.drop_table("assessment_dossier_outputs")
    op.drop_index(
        "ix_assessment_dossiers_ai_system_id",
        table_name="assessment_dossiers",
    )
    op.drop_table("assessment_dossiers")
