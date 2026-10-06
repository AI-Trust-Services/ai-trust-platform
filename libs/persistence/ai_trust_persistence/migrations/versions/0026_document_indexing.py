"""Document indexing: pgvector + documents, document_versions, document_chunks

Enables the pgvector extension and creates the document indexing tables that back
the reusable grounding/evidence retrieval feature. Chunks carry a BGE-M3 dense
`embedding vector(1024)`, a generated `content_tsv` for Postgres full-text search,
and provenance (page/bbox + structural anchor/heading path).

No ANN index on the embedding: retrieval is brute-force and always scoped
`WHERE ai_system_id = X` (small per-system search space) — see document-indexing-plan.md.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-30
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

EMBEDDING_DIM = 1024


def upgrade() -> None:
    # Extension is database-scoped; runs once (idempotent). Requires a superuser
    # connection — the app's POSTGRES_USER is the DB owner/superuser in every
    # deployment path. On a pgvector-enabled image the extension files are present.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "documents",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("ai_system_id", sa.String(20), nullable=False),
        sa.Column("filename", sa.String(300), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_documents_ai_system", "documents", ["ai_system_id"])

    op.create_table(
        "document_versions",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(20),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_label", sa.String(50), nullable=False, server_default="1.0"),
        sa.Column("minio_key", sa.String(500), nullable=False),
        sa.Column("file_name", sa.String(300), nullable=False),
        sa.Column("file_size", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("chunk_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_current", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_document_versions_document", "document_versions", ["document_id"]
    )
    op.create_index("ix_document_versions_status", "document_versions", ["status"])

    op.create_table(
        "document_chunks",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column(
            "document_version_id",
            sa.String(20),
            sa.ForeignKey("document_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ai_system_id", sa.String(20), nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("embed_text", sa.Text, nullable=False),
        sa.Column("embedding", Vector(EMBEDDING_DIM), nullable=True),
        sa.Column(
            "content_tsv",
            postgresql.TSVECTOR,
            sa.Computed("to_tsvector('simple', text)", persisted=True),
            nullable=True,
        ),
        sa.Column("page", sa.Integer, nullable=True),
        sa.Column("bbox", postgresql.JSONB, nullable=True),
        sa.Column("self_ref", sa.String(200), nullable=True),
        sa.Column("heading_path", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_document_chunks_ai_system", "document_chunks", ["ai_system_id"])
    op.create_index(
        "ix_document_chunks_version", "document_chunks", ["document_version_id"]
    )
    op.create_index(
        "ix_document_chunks_tsv",
        "document_chunks",
        ["content_tsv"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_document_chunks_tsv", table_name="document_chunks")
    op.drop_index("ix_document_chunks_version", table_name="document_chunks")
    op.drop_index("ix_document_chunks_ai_system", table_name="document_chunks")
    op.drop_table("document_chunks")
    op.drop_index("ix_document_versions_status", table_name="document_versions")
    op.drop_index("ix_document_versions_document", table_name="document_versions")
    op.drop_table("document_versions")
    op.drop_index("ix_documents_ai_system", table_name="documents")
    op.drop_table("documents")
    # Leave the `vector` extension installed — other objects may depend on it and
    # dropping an extension is not something a table migration should own.
