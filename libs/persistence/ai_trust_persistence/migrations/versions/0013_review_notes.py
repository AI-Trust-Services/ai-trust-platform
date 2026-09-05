"""Add review_notes table for POC feedback collection.

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_notes",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("page_path", sa.String(500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("author_username", sa.String(200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_review_notes_page_path", "review_notes", ["page_path"])
    op.create_index("ix_review_notes_status", "review_notes", ["status"])
    op.create_check_constraint(
        "ck_review_notes_status",
        "review_notes",
        "status IN ('pending', 'confirmed', 'rejected', 'done')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_review_notes_status", "review_notes")
    op.drop_index("ix_review_notes_status", table_name="review_notes")
    op.drop_index("ix_review_notes_page_path", table_name="review_notes")
    op.drop_table("review_notes")
