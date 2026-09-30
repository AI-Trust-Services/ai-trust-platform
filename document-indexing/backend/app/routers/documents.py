from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import Document, DocumentVersion

from app import minio_client
from app.ids import new_id
from app.schemas import DocumentStatusResponse, UploadResponse

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


def _status_response(doc: Document, version: DocumentVersion) -> DocumentStatusResponse:
    return DocumentStatusResponse(
        id=doc.id,
        ai_system_id=doc.ai_system_id,
        filename=doc.filename,
        mime_type=doc.mime_type,
        version_id=version.id,
        version_label=version.version_label,
        status=version.status,
        chunk_count=version.chunk_count,
        error=version.error,
        created_at=doc.created_at,
        indexed_at=version.indexed_at,
    )


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
    filename = os.path.basename(file.filename or "")
    if not filename:
        raise HTTPException(422, "Missing filename")
    if _ext(filename) not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            422,
            f"Unsupported file type '{_ext(filename)}'. Allowed: "
            + ", ".join(sorted(ALLOWED_EXTENSIONS)),
        )

    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_DOC_BYTES:
        raise HTTPException(413, "File too large (max 50 MB)")
    data = await file.read()
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(413, "File too large (max 50 MB)")
    if not data:
        raise HTTPException(422, "Empty file")

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
        await minio_client.delete_file(key)
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
    session: AsyncSession, document_id: str
) -> tuple[Document, DocumentVersion]:
    row = (
        await session.execute(
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
    ).first()
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


@router.delete(
    "/documents/{document_id}",
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def delete_document(document_id: str) -> dict:
    """Soft delete — the document's chunks stop appearing in new retrieval results
    (acceptance criterion 7). Indexed rows are retained."""
    async with SessionLocal() as session:
        doc = (
            await session.execute(select(Document).where(Document.id == document_id))
        ).scalar_one_or_none()
        if doc is None or doc.deleted_at is not None:
            raise HTTPException(404, f"Document {document_id} not found")
        doc.deleted_at = datetime.now(timezone.utc)
        await session.commit()
    logger.info("document.deleted", extra={"document_id": document_id})
    return {"deleted": True, "document_id": document_id}
