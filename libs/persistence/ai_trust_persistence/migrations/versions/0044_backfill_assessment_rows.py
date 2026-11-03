"""Backfill compliance Assessment rows for systems that have question_states but no Assessment

Any AI system whose single-page assessment was opened before commit 81cb6612
(which introduced the Assessment row creation in /open) has question_states rows
but no assessments row. The compliance list page and the registry Assessments tab
both query assessments and show nothing for those systems.

This migration inserts a questionnaire_pending Assessment row for every such system,
matching the values written by open_assessment() so they surface in both UIs.

Revision ID: 0044
Revises: 0043
Create Date: 2026-11-03
"""

from alembic import op
import sqlalchemy as sa
import uuid

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None

_EU_AI_ACT_FRAMEWORK_ID = "FRM-EU-AI-ACT"


def upgrade() -> None:
    conn = op.get_bind()

    # Find systems that have question_states but no non-inactive Assessment row.
    orphaned = conn.execute(sa.text("""
        SELECT DISTINCT qs.system_id, s.name
        FROM question_states qs
        JOIN ai_systems s ON s.id = qs.system_id
        WHERE NOT EXISTS (
            SELECT 1 FROM assessments a
            WHERE a.ai_system_id = qs.system_id
              AND a.status != 'inactive'
        )
    """)).fetchall()

    for system_id, system_name in orphaned:
        # Generate a prefixed ID in the same format as new_id("ASS")
        assessment_id = f"ASS-{uuid.uuid4().hex[:8].upper()}"

        conn.execute(sa.text("""
            INSERT INTO assessments
                (id, ai_system_id, framework_id, title, status, created_at, updated_at)
            VALUES
                (:id, :ai_system_id, :framework_id, :title, 'questionnaire_pending',
                 now(), now())
        """), {
            "id": assessment_id,
            "ai_system_id": system_id,
            "framework_id": _EU_AI_ACT_FRAMEWORK_ID,
            "title": f"EU AI Act Assessment — {system_name}",
        })


def downgrade() -> None:
    # Removing backfilled rows is safe — they were missing before this migration.
    op.execute(sa.text("""
        DELETE FROM assessments
        WHERE status = 'questionnaire_pending'
          AND framework_id = 'FRM-EU-AI-ACT'
          AND EXISTS (
              SELECT 1 FROM question_states qs
              WHERE qs.system_id = assessments.ai_system_id
          )
    """))
