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

from sqlalchemy import select, text, update
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
# Multi-tenancy: isolation is schema-per-tenant, so each poll runs once per tenant with the
# tenant ContextVar set — install_tenant_scoping then routes every query into that tenant's
# schema (and per-tenant role), and minio_client resolves that tenant's bucket from the same
# ContextVar. OWNER_DATABASE_URL (a role that can see the tenant schemas in the catalog) is
# used ONLY to enumerate the tenants; when unset the worker does a single unscoped pass
# (single-tenant / local dev).
OWNER_DATABASE_URL = os.environ.get("OWNER_DATABASE_URL", "")

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

try:
    from ai_trust_tenancy import install_tenant_scoping, tenant_id_var

    install_tenant_scoping(engine)
except ImportError:
    tenant_id_var = None

_owner_engine = (
    create_async_engine(OWNER_DATABASE_URL, pool_pre_ping=True)
    if OWNER_DATABASE_URL
    else None
)


async def _distinct_tenants() -> list[str]:
    """Enumerate the tenants that own data, from the per-tenant Postgres schemas.

    Isolation is schema-per-tenant (`tenant_<org>`), so the set of tenants is the set of
    those schemas. The org id is recovered by stripping the `tenant_` prefix. Returns []
    when no owner URL is configured or tenancy is off → the caller then does a single
    unscoped pass (legacy single-tenant behaviour).
    """
    if _owner_engine is None or tenant_id_var is None:
        return []
    async with _owner_engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT schema_name FROM information_schema.schemata "
                    "WHERE schema_name LIKE 'tenant\\_%'"
                )
            )
        ).all()
    return [r[0][len("tenant_") :] for r in rows if r[0].startswith("tenant_")]


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


async def _reset_stale_processing() -> int:
    """Requeue versions stuck in ``processing`` from a previous worker run.

    The claim commits ``status='processing'`` before parsing/embedding/storing. If the
    pod dies mid-flight the row would stay ``processing`` forever — ``_claim_pending``
    only ever selects ``pending``, so it is never retried and the UI shows it running
    indefinitely. On startup (before the loop) flip any such row back to ``pending`` so
    it is picked up again. Safe because only one replica runs; a multi-replica setup
    would need a heartbeat/lease to tell a crashed claim from one still in flight.
    """
    async with SessionLocal() as session:
        result = await session.execute(
            update(DocumentVersion)
            .where(DocumentVersion.status == "processing")
            .values(status="pending", stage=None)
        )
        await session.commit()
        return result.rowcount or 0


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


async def _drain() -> None:
    """Process every pending version visible in the current tenant context, then return."""
    did_work = await process_once()
    while did_work:
        did_work = await process_once()


async def _for_each_tenant(coro_factory) -> None:
    """Run an async nullary callable once per tenant (multi-tenant), setting the tenant
    ContextVar before each run, or once unscoped when no tenants are enumerable
    (single-tenant / no OWNER_DATABASE_URL)."""
    tenants = await _distinct_tenants()
    if not tenants:
        await coro_factory()
        return
    for t in tenants:
        tok = tenant_id_var.set(t) if tenant_id_var is not None else None
        try:
            log.info("document.tenant_pass", extra={"tenant_id": t})
            await coro_factory()
        finally:
            if tenant_id_var is not None and tok is not None:
                tenant_id_var.reset(tok)


async def _requeue_stale() -> None:
    n = await _reset_stale_processing()
    if n:
        log.info("document.requeued_stale", extra={"count": n})


async def main() -> None:
    global _converter, _chunker
    log.info("Document indexing worker starting — loading Docling…")
    _converter = await asyncio.to_thread(ingest.build_converter)
    _chunker = await asyncio.to_thread(ingest.build_chunker)
    # Recover any version left mid-flight by a previous crash before serving the queue.
    await _for_each_tenant(_requeue_stale)
    log.info("Document indexing worker started (interval=%ds)", POLL_INTERVAL)

    while True:
        try:
            # Drain all pending work (once per tenant), then sleep.
            await _for_each_tenant(_drain)
        except Exception:
            log.exception("document.worker_error")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
