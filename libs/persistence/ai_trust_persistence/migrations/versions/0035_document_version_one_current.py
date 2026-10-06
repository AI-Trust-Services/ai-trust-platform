"""Document indexing: at most one current version per document

`upload_version` demotes the old current version and inserts a new `is_current=True`
one. Without a DB-level guard, two concurrent uploads for the same document could both
read the same current row, both demote it, and each insert its own `is_current=True`
row — leaving the document with multiple "current" versions, which the retrieval and
status queries assume cannot happen. A partial unique index on `(document_id) WHERE
is_current` makes that second insert fail, so the losing upload rolls back instead of
corrupting the invariant. The router pairs this with `SELECT ... FOR UPDATE` on the
current version so the common case serialises cleanly rather than erroring.

Revision ID: 0035
Revises: 0034
Create Date: 2026-10-06
"""

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX uq_document_versions_one_current "
        "ON document_versions (document_id) WHERE is_current"
    )


def downgrade() -> None:
    op.drop_index("uq_document_versions_one_current", table_name="document_versions")
