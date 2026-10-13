"""Document indexing: build the FTS column from embed_text instead of raw text

The generated `content_tsv` was `to_tsvector('simple', text)` — the raw chunk body
only. Docling keeps a chunk's heading separate from its body, so an identifier that
lives in a heading (e.g. "Article 70" in the EU AI Act) was absent from `text` and
therefore absent from the FTS index. Because websearch_to_tsquery ANDs the query
terms, a search for "Article 70" could never match that chunk via the lexical channel,
and the dense channel alone is unreliable at bare numbers — so the passage was missed.

embed_text is the contextualised form (heading path + body) already used for the dense
embedding, so switching the FTS column to it puts the heading tokens into the index
without any re-embedding. Postgres recomputes the STORED generated column for every
existing row as soon as it is re-added, so already-indexed documents are fixed in place.

A generated column's expression cannot be altered in Postgres 16, so the column is
dropped and recreated; the GIN index drops with it and is rebuilt.

Revision ID: 0034
Revises: 0033
Create Date: 2026-10-05
"""

from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def _rebuild_tsv(source_column: str) -> None:
    op.drop_index("ix_document_chunks_tsv", table_name="document_chunks")
    op.drop_column("document_chunks", "content_tsv")
    op.execute(
        "ALTER TABLE document_chunks "
        "ADD COLUMN content_tsv tsvector "
        f"GENERATED ALWAYS AS (to_tsvector('simple', {source_column})) STORED"
    )
    op.execute(
        "CREATE INDEX ix_document_chunks_tsv ON document_chunks USING gin (content_tsv)"
    )


def upgrade() -> None:
    _rebuild_tsv("embed_text")


def downgrade() -> None:
    _rebuild_tsv("text")
