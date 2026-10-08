from __future__ import annotations

import os

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import AISystem, Document, DocumentVersion

from app import minio_client
from app.ids import new_id
from app.schemas import (
    DocumentStatusResponse,
    DownloadUrlResponse,
    UploadResponse,
    VersionResponse,
)

router = APIRouter(tags=["documents"])
logger = get_logger(__name__)

MAX_DOC_BYTES = 50 * 1024 * 1024  # 50 MB (nginx allows 50 MB)

# Docling-parseable formats (see experiments/document-indexing/ingest.py) plus txt.
ALLOWED_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".pptx",
    ".md",
    ".markdown",
    ".html",
    ".htm",
    ".txt",
}


def _ext(filename: str) -> str:
    return os.path.splitext(filename)[1].lower()


async def _ensure_system_exists(session: AsyncSession, system_id: str) -> None:
    """Reject uploads for unknown AI systems. ``documents.ai_system_id`` has no FK
    (it points at the registry's table and retrieval scans by it directly), so without
    this check an arbitrary path ID would create orphaned DB + MinIO data."""
    exists = (
        await session.execute(select(AISystem.id).where(AISystem.id == system_id))
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(404, f"AI system {system_id} not found")


def _status_response(doc: Document, version: DocumentVersion) -> DocumentStatusResponse:
    return DocumentStatusResponse(
        id=doc.id,
        ai_system_id=doc.ai_system_id,
        filename=doc.filename,
        mime_type=doc.mime_type,
        version_id=version.id,
        version_label=version.version_label,
        status=version.status,
        stage=version.stage,
        chunk_count=version.chunk_count,
        error=version.error,
        created_at=doc.created_at,
        indexed_at=version.indexed_at,
    )


async def _read_valid_upload(request: Request, file: UploadFile) -> tuple[str, bytes]:
    """Validate an upload (name, extension, size, non-empty) and return (filename, bytes).
    Shared by the first upload and the new-version upload."""
    filename = os.path.basename(file.filename or "")
    if not filename:
        raise HTTPException(422, "Missing filename")
    if _ext(filename) not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            422,
            f"Unsupported file type '{_ext(filename)}'. Allowed: "
            + ", ".join(sorted(ALLOWED_EXTENSIONS)),
        )

    # Content-Length is client-controlled; a non-numeric value must not 500 here —
    # the actual byte-length check below is the real guard, this is just an early-out.
    content_length = request.headers.get("content-length")
    if (
        content_length
        and content_length.isdigit()
        and int(content_length) > MAX_DOC_BYTES
    ):
        raise HTTPException(413, "File too large (max 50 MB)")
    data = await file.read()
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(413, "File too large (max 50 MB)")
    if not data:
        raise HTTPException(422, "Empty file")
    return filename, data


def _next_version_label(versions: list[DocumentVersion]) -> str:
    """Next major version label, e.g. existing 1.0 → '2.0'. Falls back to '1.0'."""
    majors = []
    for v in versions:
        try:
            majors.append(int(str(v.version_label).split(".")[0]))
        except (ValueError, IndexError):
            pass
    return f"{(max(majors) + 1) if majors else 1}.0"


@router.post(
    "/systems/{system_id}/documents",
    response_model=UploadResponse,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def upload_document(
    system_id: str, request: Request, file: UploadFile = File(...)
) -> UploadResponse:
    """Upload a document for an AI system. Stores the original in MinIO and creates a
    ``pending`` version; the worker picks it up and indexes it asynchronously."""
    filename, data = await _read_valid_upload(request, file)

    async with SessionLocal() as session:
        await _ensure_system_exists(session, system_id)

    document_id = new_id("DOC")
    version_id = new_id("DOCV")

    await minio_client.ensure_bucket()
    key = await minio_client.upload_file(
        document_id, version_id, filename, data, file.content_type or ""
    )

    try:
        async with SessionLocal() as session:
            session.add(
                Document(
                    id=document_id,
                    ai_system_id=system_id,
                    filename=filename,
                    mime_type=file.content_type,
                )
            )
            session.add(
                DocumentVersion(
                    id=version_id,
                    document_id=document_id,
                    version_label="1.0",
                    minio_key=key,
                    file_name=filename,
                    file_size=len(data),
                    status="pending",
                    is_current=True,
                )
            )
            await session.commit()
    except Exception:
        # Compensating delete so a failed insert doesn't orphan the object.
        try:
            await minio_client.delete_file(key)
        except Exception:
            logger.exception(
                "document.upload_cleanup_failed",
                extra={"system_id": system_id, "key": key},
            )
        logger.exception("document.upload_failed", extra={"system_id": system_id})
        raise

    logger.info(
        "document.uploaded",
        extra={"document_id": document_id, "system_id": system_id},
    )
    return UploadResponse(
        document_id=document_id, version_id=version_id, status="pending"
    )


@router.get(
    "/systems/{system_id}/documents",
    response_model=list[DocumentStatusResponse],
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def list_documents(system_id: str) -> list[DocumentStatusResponse]:
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(Document, DocumentVersion)
                .join(
                    DocumentVersion,
                    and_(
                        DocumentVersion.document_id == Document.id,
                        DocumentVersion.is_current.is_(True),
                    ),
                )
                .where(
                    Document.ai_system_id == system_id,
                    Document.deleted_at.is_(None),
                )
                .order_by(Document.created_at.desc())
            )
        ).all()
    return [_status_response(doc, version) for doc, version in rows]


async def _load_current(
    session: AsyncSession, document_id: str, *, for_update: bool = False
) -> tuple[Document, DocumentVersion]:
    stmt = (
        select(Document, DocumentVersion)
        .join(
            DocumentVersion,
            and_(
                DocumentVersion.document_id == Document.id,
                DocumentVersion.is_current.is_(True),
            ),
        )
        .where(Document.id == document_id, Document.deleted_at.is_(None))
    )
    # Lock the current version row during a version swap so two concurrent uploads
    # can't both demote it and each insert a new is_current=True row.
    if for_update:
        stmt = stmt.with_for_update(of=DocumentVersion)
    row = (await session.execute(stmt)).first()
    if row is None:
        raise HTTPException(404, f"Document {document_id} not found")
    return row[0], row[1]


@router.get(
    "/documents/{document_id}",
    response_model=DocumentStatusResponse,
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def get_document(document_id: str) -> DocumentStatusResponse:
    async with SessionLocal() as session:
        doc, version = await _load_current(session, document_id)
    return _status_response(doc, version)


@router.post(
    "/documents/{document_id}/versions",
    response_model=UploadResponse,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def upload_version(
    document_id: str, request: Request, file: UploadFile = File(...)
) -> UploadResponse:
    """Upload a new version of a document. The new version becomes current and is
    re-indexed; the previous version's chunks drop out of new retrieval results
    (``is_current=False``) while its history and file are retained (acceptance criterion 7)."""
    filename, data = await _read_valid_upload(request, file)
    new_version_id = new_id("DOCV")

    await minio_client.ensure_bucket()
    key = await minio_client.upload_file(
        document_id, new_version_id, filename, data, file.content_type or ""
    )

    try:
        async with SessionLocal() as session:
            doc, current = await _load_current(session, document_id, for_update=True)
            versions = list(
                (
                    await session.execute(
                        select(DocumentVersion).where(
                            DocumentVersion.document_id == document_id
                        )
                    )
                ).scalars()
            )
            current.is_current = False
            session.add(
                DocumentVersion(
                    id=new_version_id,
                    document_id=document_id,
                    version_label=_next_version_label(versions),
                    minio_key=key,
                    file_name=filename,
                    file_size=len(data),
                    status="pending",
                    is_current=True,
                )
            )
            # Keep the parent's display name/type in sync with the current version.
            doc.filename = filename
            doc.mime_type = file.content_type
            await session.commit()
    except Exception:
        # Compensating delete so a failed swap doesn't orphan the object.
        try:
            await minio_client.delete_file(key)
        except Exception:
            logger.exception(
                "document.version_upload_cleanup_failed",
                extra={"document_id": document_id, "key": key},
            )
        logger.exception(
            "document.version_upload_failed", extra={"document_id": document_id}
        )
        raise

    logger.info(
        "document.version_uploaded",
        extra={"document_id": document_id, "version_id": new_version_id},
    )
    return UploadResponse(
        document_id=document_id, version_id=new_version_id, status="pending"
    )


@router.get(
    "/documents/{document_id}/versions",
    response_model=list[VersionResponse],
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def list_versions(document_id: str) -> list[VersionResponse]:
    """Version history, oldest-first (acceptance criterion: maintain document versions)."""
    async with SessionLocal() as session:
        doc = (
            await session.execute(select(Document).where(Document.id == document_id))
        ).scalar_one_or_none()
        if doc is None or doc.deleted_at is not None:
            raise HTTPException(404, f"Document {document_id} not found")
        rows = list(
            (
                await session.execute(
                    select(DocumentVersion)
                    .where(DocumentVersion.document_id == document_id)
                    .order_by(DocumentVersion.created_at.asc())
                )
            ).scalars()
        )
    return [VersionResponse.model_validate(r) for r in rows]


@router.get(
    "/documents/{document_id}/download-url",
    response_model=DownloadUrlResponse,
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def document_download_url(
    document_id: str, version_id: str | None = None
) -> DownloadUrlResponse:
    """Presigned URL to a document's original file, so a retrieved passage can be traced
    back and opened at its source (acceptance criterion 6). Defaults to the current
    version; pass ``version_id`` to open the exact version a passage came from — a
    retrieval result references ``source.version_id``, which may no longer be current if
    a new version was uploaded between search and click."""
    async with SessionLocal() as session:
        if version_id is None:
            _, version = await _load_current(session, document_id)
        else:
            version = (
                await session.execute(
                    select(DocumentVersion).where(
                        DocumentVersion.id == version_id,
                        DocumentVersion.document_id == document_id,
                    )
                )
            ).scalar_one_or_none()
            if version is None:
                raise HTTPException(
                    404, f"Version {version_id} not found for document {document_id}"
                )
        key = version.minio_key
    url = await minio_client.get_presigned_url(key)
    return DownloadUrlResponse(url=url, expires_hours=1)


@router.delete(
    "/documents/{document_id}",
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def delete_document(document_id: str) -> dict:
    """Hard delete — the document row is removed; the ON DELETE CASCADE FKs drop every
    version and chunk with it, and the originals are purged from MinIO. Nothing of a
    deleted document is retained (chunks naturally stop appearing in retrieval)."""
    async with SessionLocal() as session:
        keys = await _purge_document(session, document_id)
        await session.commit()
    # MinIO has no cascade — delete each version's original after the DB row is gone
    # (best-effort: delete_file logs failures instead of raising, so an orphaned object
    # never blocks the delete; a dangling DB row would be the worse outcome).
    for key in keys:
        await minio_client.delete_file(key)
    logger.info("document.deleted", extra={"document_id": document_id})
    return {"deleted": True, "document_id": document_id}


async def _purge_document(session: AsyncSession, document_id: str) -> list[str]:
    """Delete the document row (cascading to its versions + chunks) and return the
    MinIO keys of every version so the caller can purge the originals. Raises 404 if
    the document does not exist."""
    doc = (
        await session.execute(select(Document).where(Document.id == document_id))
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(404, f"Document {document_id} not found")
    keys = list(
        (
            await session.execute(
                select(DocumentVersion.minio_key).where(
                    DocumentVersion.document_id == document_id
                )
            )
        )
        .scalars()
        .all()
    )
    await session.delete(doc)  # ON DELETE CASCADE removes versions + chunks
    return keys
