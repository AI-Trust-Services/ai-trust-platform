"""Document indexing: add document_versions.stage for fine-grained progress

Adds a nullable `stage` column the indexing worker writes while a version is being
processed (parsing | embedding | storing), so the API/UI can show progress between
the coarse `pending → processing → indexed` status transitions. Null outside the
`processing` state.

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-05
"""

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_versions",
        sa.Column("stage", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_versions", "stage")
