"""Per-question assessment state + comments for the single-page EU AI Act flow

Adds two per-system tables backing the redesigned single-page assessment:

- ``question_states`` — per-question review state (confirm status, answer source
  + AI-original answer, per-question confidence band, per-question assignment),
  keyed uniquely by (system_id, question_key).
- ``question_comments`` — per-question comment thread with soft delete.

The legacy ``question_assignments`` table is intentionally NOT dropped here; it
is removed in a later migration once the section-sequenced workflow endpoints
that still read it are retired.

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "question_states",
        sa.Column("id", sa.String(20), nullable=False),
        sa.Column("assessment_id", sa.String(30), nullable=False),
        sa.Column("system_id", sa.String(20), nullable=False),
        sa.Column("question_key", sa.String(100), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "answer_source",
            sa.String(20),
            nullable=False,
            server_default="ai_prefilled",
        ),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("ai_original_answer", sa.Text(), nullable=True),
        sa.Column("confidence", sa.String(10), nullable=True),
        sa.Column("assignee_username", sa.String(200), nullable=True),
        sa.Column("assigned_by_username", sa.String(200), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["assessment_id"], ["assessments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["system_id"], ["ai_systems.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assessment_id", "question_key", name="uq_question_state"),
    )
    op.create_index("ix_question_states_system_id", "question_states", ["system_id"])
    op.create_index(
        "ix_question_states_assessment_id", "question_states", ["assessment_id"]
    )

    op.create_table(
        "question_comments",
        sa.Column("id", sa.String(20), nullable=False),
        sa.Column("assessment_id", sa.String(30), nullable=False),
        sa.Column("system_id", sa.String(20), nullable=False),
        sa.Column("question_key", sa.String(100), nullable=False),
        sa.Column("author_username", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["assessment_id"], ["assessments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["system_id"], ["ai_systems.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_question_comments_system_id", "question_comments", ["system_id"]
    )
    op.create_index(
        "ix_question_comments_assessment_id", "question_comments", ["assessment_id"]
    )
    op.create_index(
        "ix_question_comments_question_key",
        "question_comments",
        ["question_key"],
    )


def downgrade() -> None:
    op.drop_index("ix_question_comments_question_key", table_name="question_comments")
    op.drop_index("ix_question_comments_assessment_id", table_name="question_comments")
    op.drop_index("ix_question_comments_system_id", table_name="question_comments")
    op.drop_table("question_comments")
    op.drop_index("ix_question_states_assessment_id", table_name="question_states")
    op.drop_index("ix_question_states_system_id", table_name="question_states")
    op.drop_table("question_states")
