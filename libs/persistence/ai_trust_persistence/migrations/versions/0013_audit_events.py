"""Create audit_events table for the write-through audit buffer

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-03
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("actor_username", sa.String(200), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(50), nullable=False),
        sa.Column("ai_system_id", sa.String(20), nullable=True),
        sa.Column("ai_system_name", sa.String(200), nullable=True),
        sa.Column("changes", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("source", sa.String(20), nullable=False, server_default="ui"),
        sa.Column("flushed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_audit_events_flushed_created", "audit_events", ["flushed_at", "created_at"])
    op.create_index("ix_audit_events_ai_system_created", "audit_events", ["ai_system_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_events_ai_system_created", table_name="audit_events")
    op.drop_index("ix_audit_events_flushed_created", table_name="audit_events")
    op.drop_table("audit_events")
