"""Evidence versioning: add evidence_versions table and version_label to evidence

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-21
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add version_label to the evidence row (tracks the current version label)
    op.add_column("evidence", sa.Column(
        "version_label", sa.String(50), nullable=False, server_default="1.0"
    ))

    # Evidence version history — one row per previous version snapshot
    op.create_table(
        "evidence_versions",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("evidence_id", sa.String(30),
                  sa.ForeignKey("evidence.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("version_label", sa.String(50), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False, server_default=""),
        sa.Column("file_name", sa.String(300), nullable=False, server_default=""),
        sa.Column("file_size", sa.Integer, nullable=False, server_default="0"),
        sa.Column("mime_type", sa.String(100), nullable=False, server_default=""),
        sa.Column("uploaded_by", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("evidence_versions")
    op.drop_column("evidence", "version_label")
