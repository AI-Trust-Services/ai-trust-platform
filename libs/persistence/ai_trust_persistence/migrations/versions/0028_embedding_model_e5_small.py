"""Document indexing: switch embedding model to multilingual-e5-small (vector 1024 → 384)

The embedding model changes from BAAI/bge-m3 (1024-dim) to intfloat/multilingual-e5-small
(384-dim) — far cheaper on CPU while holding retrieval quality on the validation set.
The vector dimension is physical, so the column type must change; existing 1024-dim
vectors cannot be cast and are invalid under the new model.

This migration therefore clears all indexed chunks and resets their versions to
``pending`` so the worker re-indexes them with the new model. (On this branch nothing
is in production yet; a re-index is the intended, documented behaviour for a model swap.)

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-05
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

OLD_DIM = 1024
NEW_DIM = 384


def _reindex(dim: int) -> None:
    # Chunks hold vectors of the old dimension — invalid under the new model. Drop them
    # and reset their versions so the worker re-indexes from the originals in MinIO.
    op.execute("DELETE FROM document_chunks")
    op.execute(
        "UPDATE document_versions "
        "SET status = 'pending', stage = NULL, chunk_count = 0, indexed_at = NULL "
        "WHERE status <> 'pending'"
    )
    # Table is now empty, so the type change needs no USING cast.
    op.alter_column(
        "document_chunks",
        "embedding",
        type_=Vector(dim),
        existing_nullable=True,
    )


def upgrade() -> None:
    _reindex(NEW_DIM)


def downgrade() -> None:
    _reindex(OLD_DIM)
