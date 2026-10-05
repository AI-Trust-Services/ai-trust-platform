"""Document Indexing Worker — turns uploaded documents into searchable chunks.

Polls Postgres for ``document_versions`` in status ``pending`` (the queue is the DB —
no broker), claims one with ``FOR UPDATE SKIP LOCKED``, then:
  1. download the original from MinIO
  2. Docling → structure-aware chunks with provenance
  3. embed passages via the shared embedding service (dense vectors)
  4. insert chunks (embedding + generated FTS column) and mark the version ``indexed``

On any failure the version is marked ``failed`` with the error message, so the API can
expose it (acceptance criterion 1). The status column is the single source of truth.
"""

import asyncio
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from ai_trust_logging import get_logger
from ai_trust_persistence.models import Document, DocumentChunk, DocumentVersion

import embedding_client
import ingest
import minio_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = get_logger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
POLL_INTERVAL = int(os.environ.get("INDEXING_POLL_INTERVAL", "10"))

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

try:
    from ai_trust_tenancy import install_tenant_scoping

    install_tenant_scoping(engine)
except ImportError:
    pass

# Built once at startup and reused across documents (per-doc rebuild pings HF → 429).
_converter = None
_chunker = None


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


async def _claim_pending() -> dict | None:
    """Atomically claim one pending version (→ processing). Returns its work info.

    Skips versions whose document was soft-deleted — indexing them would be wasted
    work (their chunks are filtered out of retrieval) and would delay live uploads.
    """
    async with SessionLocal() as session:
        row = (
            await session.execute(
                select(DocumentVersion)
                .where(
                    DocumentVersion.status == "pending",
                    DocumentVersion.document_id.in_(
                        select(Document.id).where(Document.deleted_at.is_(None))
                    ),
                )
                .order_by(DocumentVersion.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if row is None:
            return None

        ai_system_id = (
            await session.execute(
                select(Document.ai_system_id).where(Document.id == row.document_id)
            )
        ).scalar_one()

        row.status = "processing"
        await session.commit()
        return {
            "version_id": row.id,
            "minio_key": row.minio_key,
            "file_name": row.file_name,
            "ai_system_id": ai_system_id,
        }


def _parse_bytes(data: bytes, file_name: str) -> list[ingest.Chunk]:
    """Blocking: write to a temp file with the correct extension, then Docling-parse.

    Naming the temp file with the known extension lets Docling route to the right
    backend for well-formed uploads; conversion failures raise and become status=failed.
    """
    suffix = os.path.splitext(file_name)[1].lower() or ".bin"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()
        return ingest.parse_and_chunk(Path(tmp.name), _converter, _chunker)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


async def _mark_failed(version_id: str, error: str) -> None:
    async with SessionLocal() as session:
        row = (
            await session.execute(
                select(DocumentVersion).where(DocumentVersion.id == version_id)
            )
        ).scalar_one_or_none()
        if row is not None:
            row.status = "failed"
            row.stage = None
            row.error = error[:2000]
            await session.commit()


async def _set_stage(version_id: str, stage: str) -> None:
    """Record the current processing phase so the API/UI can show progress."""
    async with SessionLocal() as session:
        row = (
            await session.execute(
                select(DocumentVersion).where(DocumentVersion.id == version_id)
            )
        ).scalar_one_or_none()
        if row is not None:
            row.stage = stage
            await session.commit()


async def _process(work: dict) -> None:
    version_id = work["version_id"]
    ai_system_id = work["ai_system_id"]

    await _set_stage(version_id, "parsing")
    data = await minio_client.download_file(work["minio_key"])
    chunks = await asyncio.to_thread(_parse_bytes, data, work["file_name"])
    if not chunks:
        raise ValueError("Document produced no chunks")

    await _set_stage(version_id, "embedding")
    vectors = await embedding_client.embed([c.embed_text for c in chunks])
    if len(vectors) != len(chunks):
        raise ValueError("Embedding count does not match chunk count")

    await _set_stage(version_id, "storing")
    async with SessionLocal() as session:
        for chunk, vector in zip(chunks, vectors):
            session.add(
                DocumentChunk(
                    id=_new_id("CHNK"),
                    document_version_id=version_id,
                    ai_system_id=ai_system_id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    embed_text=chunk.embed_text,
                    embedding=vector,
                    page=chunk.page,
                    bbox=chunk.bbox or None,
                    self_ref=chunk.self_ref,
                    heading_path=chunk.heading_path or None,
                )
            )
        row = (
            await session.execute(
                select(DocumentVersion).where(DocumentVersion.id == version_id)
            )
        ).scalar_one()
        row.status = "indexed"
        row.stage = None
        row.chunk_count = len(chunks)
        row.indexed_at = datetime.now(timezone.utc)
        await session.commit()

    log.info(
        "document.indexed",
        extra={"version_id": version_id, "chunks": len(chunks)},
    )


async def process_once() -> bool:
    """Claim and process one pending version. Returns True if work was done."""
    work = await _claim_pending()
    if work is None:
        return False
    try:
        await _process(work)
    except Exception as e:  # noqa: BLE001 — mark failed and keep the worker alive
        log.exception("document.index_failed", extra={"version_id": work["version_id"]})
        await _mark_failed(work["version_id"], str(e))
    return True


async def main() -> None:
    global _converter, _chunker
    log.info("Document indexing worker starting — loading Docling…")
    _converter = await asyncio.to_thread(ingest.build_converter)
    _chunker = await asyncio.to_thread(ingest.build_chunker)
    log.info("Document indexing worker started (interval=%ds)", POLL_INTERVAL)

    while True:
        try:
            # Drain all pending work, then sleep.
            did_work = await process_once()
            while did_work:
                did_work = await process_once()
        except Exception:
            log.exception("document.worker_error")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
