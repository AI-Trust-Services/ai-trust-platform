"""Document indexing models: documents, versions, and indexed chunks.

An uploaded document is linked to an AI system (``Document``). Each upload of its
content is a ``DocumentVersion`` carrying the MinIO object key and the async
indexing ``status`` (pending → processing → indexed / failed) — that status column
is the single source of truth exposed by the API (acceptance criterion 1).

Indexing produces ``DocumentChunk`` rows: the raw text (for display / full-text
search), the contextualised text that was embedded, the dense embedding vector, a
generated ``content_tsv`` for Postgres FTS, and provenance (page / bbox / structural
anchor / heading path) so every retrieved passage traces back to its source location
(acceptance criterion 6).

Retrieval is brute-force and always scoped ``WHERE ai_system_id = X`` (small per-system
search space) — deliberately no ANN index (see ``document-indexing-plan.md``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base

# Dense embedding dimensionality. Must match the active EMBED_MODEL served by
# embedding-service: multilingual-e5-small = 384 (e5-base = 768, bge-m3 = 1024).
# Changing the model means a migration altering document_chunks.embedding + re-index.
EMBEDDING_DIM = 384


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    ai_system_id: Mapped[str] = mapped_column(String(20), nullable=False)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Vestigial: delete is now a hard delete (the document row is removed and its
    # versions/chunks/MinIO originals purged), so nothing ever sets this. Retained so
    # the `deleted_at IS NULL` retrieval filters stay valid no-ops; drop in a future
    # cleanup migration if soft delete is not reintroduced.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (Index("ix_documents_ai_system", "ai_system_id"),)


class DocumentVersion(Base):
    __tablename__ = "document_versions"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    version_label: Mapped[str] = mapped_column(
        String(50), nullable=False, default="1.0"
    )
    minio_key: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(300), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # pending → processing → indexed | failed
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending"
    )
    # Fine-grained phase while status == 'processing' (parsing | embedding | storing),
    # written by the worker so the API/UI can show progress; null otherwise.
    stage: Mapped[str | None] = mapped_column(String(20), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    indexed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_document_versions_document", "document_id"),
        # The worker polls this: pending rows first.
        Index("ix_document_versions_status", "status"),
        # At most one current version per document — enforces the version-swap
        # invariant at the DB level so concurrent uploads can't create two.
        Index(
            "uq_document_versions_one_current",
            "document_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    document_version_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("document_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Denormalised from the version's document so retrieval can filter
    # `WHERE ai_system_id = X` without a join (brute-force scan stays cheap).
    ai_system_id: Mapped[str] = mapped_column(String(20), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embed_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[Any] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    # Generated FTS column. 'simple' config (no stemming) keeps exact IDs/codes
    # matchable — the lexical channel's whole point (acceptance criterion 4).
    # Built from embed_text (contextualised: heading path + body), NOT the raw body,
    # so an identifier that lives in a heading — e.g. "Article 70" in a legal doc —
    # is in the searched field. websearch_to_tsquery ANDs the query terms, so a bare
    # `text` (body only) could never match a heading-only ID and the lexical channel
    # silently missed it; embed_text puts the heading tokens in the index.
    content_tsv: Mapped[Any] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', embed_text)", persisted=True),
        nullable=True,
    )
    # Provenance — both forms: page/bbox (PDF) and structural anchor + heading path.
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bbox: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    self_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    heading_path: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_document_chunks_ai_system", "ai_system_id"),
        Index("ix_document_chunks_version", "document_version_id"),
        Index("ix_document_chunks_tsv", "content_tsv", postgresql_using="gin"),
    )
