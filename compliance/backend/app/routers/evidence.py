from __future__ import annotations

import os
from datetime import date, datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import (
    AISystem,
    Assessment,
    Control,
    Evidence,
    EvidenceVersion,
    Obligation,
    evidence_controls,
    evidence_obligations,
)
from app import minio_client
from app.cascade import refresh_control_effectiveness, refresh_obligation, refresh_obligations_for_control
from app.ids import new_id
from app.schemas import (
    DownloadUrlResponse,
    EvidenceDetailResponse,
    EvidenceResponse,
    EvidenceUpdate,
    EvidenceVersionResponse,
)
from app.schemas.evidence import VALID_EVIDENCE_TYPES

router = APIRouter(tags=["evidence"])
logger = get_logger(__name__)

MAX_FILE_BYTES = 100 * 1024 * 1024  # 100 MB, per spec EVD-FR-01

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".png", ".jpg", ".jpeg", ".xlsx", ".csv", ".json", ".zip", ".txt"}
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png", "image/jpeg",
    "text/csv", "text/plain",
    "application/json",
    "application/zip",
}


def _parse_date(value: str | None, field: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"{field} must be an ISO date (YYYY-MM-DD)")


async def _load(session: AsyncSession, evidence_id: str) -> Evidence:
    row = (await session.execute(
        select(Evidence).where(Evidence.id == evidence_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Evidence {evidence_id} not found")
    return row


async def _linked_ids(session: AsyncSession, evidence_id: str) -> tuple[list[str], list[str]]:
    control_ids = (await session.execute(
        select(evidence_controls.c.control_id).where(evidence_controls.c.evidence_id == evidence_id)
    )).scalars().all()
    obligation_ids = (await session.execute(
        select(evidence_obligations.c.obligation_id).where(evidence_obligations.c.evidence_id == evidence_id)
    )).scalars().all()
    return list(control_ids), list(obligation_ids)


@router.get("/evidence", response_model=list[EvidenceResponse])
async def list_evidence(
    control_id: str | None = Query(default=None),
    obligation_id: str | None = Query(default=None),
    ai_system_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[EvidenceResponse]:
    async with SessionLocal() as session:
        stmt = select(Evidence).order_by(Evidence.created_at.desc())
        if control_id:
            stmt = stmt.join(
                evidence_controls, evidence_controls.c.evidence_id == Evidence.id
            ).where(evidence_controls.c.control_id == control_id)
        if obligation_id:
            stmt = stmt.join(
                evidence_obligations, evidence_obligations.c.evidence_id == Evidence.id
            ).where(evidence_obligations.c.obligation_id == obligation_id)
        if ai_system_id:
            stmt = stmt.where(Evidence.ai_system_id == ai_system_id)
        stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [EvidenceResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/evidence", response_model=EvidenceDetailResponse, status_code=201)
async def create_evidence(
    title: str = Form(...),
    description: str = Form(default=""),
    evidence_type: str = Form(default="document"),
    control_ids: list[str] = Form(default=[]),
    obligation_ids: list[str] = Form(default=[]),
    ai_system_id: str | None = Form(default=None),
    assessment_id: str | None = Form(default=None),
    validity_from: str | None = Form(default=None),
    validity_until: str | None = Form(default=None),
    uploaded_by: str = Form(default=""),
    file: UploadFile | None = File(default=None),
) -> EvidenceDetailResponse:
    if not title.strip():
        raise HTTPException(422, "title must not be blank")
    if evidence_type not in VALID_EVIDENCE_TYPES:
        raise HTTPException(422, f"invalid evidence type '{evidence_type}'")
    # At least one link target is required (spec EVD-FR-02).
    if not any([control_ids, obligation_ids, ai_system_id, assessment_id]):
        raise HTTPException(422, "Evidence must link to at least one of: control, obligation, AI system, or assessment")

    v_from = _parse_date(validity_from, "validity_from")
    v_until = _parse_date(validity_until, "validity_until")

    # 1) Validate every supplied link target in a short-lived session, so we
    #    return clean 404s and never touch object storage on a bad reference.
    async with SessionLocal() as session:
        for cid in control_ids:
            if not (await session.execute(
                select(Control.id).where(Control.id == cid)
            )).scalar_one_or_none():
                raise HTTPException(404, f"Control {cid} not found")
        for oid in obligation_ids:
            if not (await session.execute(
                select(Obligation.id).where(Obligation.id == oid)
            )).scalar_one_or_none():
                raise HTTPException(404, f"Obligation {oid} not found")
        if ai_system_id and not (await session.execute(
            select(AISystem.id).where(AISystem.id == ai_system_id)
        )).scalar_one_or_none():
            raise HTTPException(404, f"AI system {ai_system_id} not found")
        if assessment_id and not (await session.execute(
            select(Assessment.id).where(Assessment.id == assessment_id)
        )).scalar_one_or_none():
            raise HTTPException(404, f"Assessment {assessment_id} not found")

    evidence_id = new_id("EVD")
    file_path = file_name = mime_type = ""
    file_size = 0

    # 2) Upload the file to MinIO BEFORE opening the write transaction, so no DB
    #    connection is held across the (potentially slow, large) upload.
    if file is not None and file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(422, f"File type '{ext}' is not allowed")
        mime = file.content_type or "application/octet-stream"
        if mime not in ALLOWED_MIME_TYPES:
            raise HTTPException(422, f"MIME type '{mime}' is not allowed")
        data = await file.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, f"File exceeds maximum size of {MAX_FILE_BYTES // (1024 * 1024)} MB")
        await minio_client.ensure_bucket()
        file_path = await minio_client.upload_file(
            evidence_id, file.filename, data, file.content_type or "application/octet-stream"
        )
        file_name = file.filename
        file_size = len(data)
        mime_type = file.content_type or "application/octet-stream"

    # 3) Persist the row + links. If anything fails, remove the orphaned object.
    try:
        async with SessionLocal() as session:
            row = Evidence(
                id=evidence_id,
                ai_system_id=ai_system_id,
                assessment_id=assessment_id,
                title=title,
                description=description,
                evidence_type=evidence_type,
                status="pending",
                validity_from=v_from,
                validity_until=v_until,
                file_path=file_path,
                file_name=file_name,
                file_size=file_size,
                mime_type=mime_type,
                uploaded_by=uploaded_by,
            )
            session.add(row)
            await session.flush()

            for cid in control_ids:
                await session.execute(pg_insert(evidence_controls).values(
                    evidence_id=evidence_id, control_id=cid).on_conflict_do_nothing())
            for oid in obligation_ids:
                await session.execute(pg_insert(evidence_obligations).values(
                    evidence_id=evidence_id, obligation_id=oid).on_conflict_do_nothing())

            await session.commit()
            await session.refresh(row)
            linked_control_ids, linked_obligation_ids = await _linked_ids(session, evidence_id)
    except Exception:
        if file_path:
            await minio_client.delete_file(file_path)
        raise

    logger.info("evidence.created", extra={
        "evidence_id": evidence_id, "has_file": bool(file_name), "size": file_size,
    })
    detail = EvidenceDetailResponse.model_validate(row)
    detail.control_ids = linked_control_ids
    detail.obligation_ids = linked_obligation_ids
    return detail


@router.get("/evidence/{evidence_id}", response_model=EvidenceDetailResponse)
async def get_evidence(evidence_id: str) -> EvidenceDetailResponse:
    async with SessionLocal() as session:
        row = await _load(session, evidence_id)
        control_ids, obligation_ids = await _linked_ids(session, evidence_id)
        detail = EvidenceDetailResponse.model_validate(row)
        detail.control_ids = control_ids
        detail.obligation_ids = obligation_ids
        return detail


@router.get("/evidence/{evidence_id}/download-url", response_model=DownloadUrlResponse)
async def get_download_url(evidence_id: str) -> DownloadUrlResponse:
    async with SessionLocal() as session:
        row = await _load(session, evidence_id)
        if not row.file_path:
            raise HTTPException(404, "Evidence has no attached file")
    url = await minio_client.get_presigned_url(row.file_path, expires_hours=1)
    logger.info("evidence.download_url_issued", extra={"evidence_id": evidence_id})
    return DownloadUrlResponse(url=url, expires_hours=1)


@router.put("/evidence/{evidence_id}", response_model=EvidenceResponse)
async def update_evidence(evidence_id: str, body: EvidenceUpdate) -> EvidenceResponse:
    updates = body.model_dump(exclude_none=True)
    async with SessionLocal() as session:
        row = await _load(session, evidence_id)
        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)
        await session.flush()
        # A manual status change (e.g. to/from approved) affects control effectiveness.
        if "status" in updates:
            await _cascade_from_evidence(session, evidence_id)
        await session.commit()
        await session.refresh(row)
    logger.info("evidence.updated", extra={"evidence_id": evidence_id, "fields": sorted(updates.keys())})
    return EvidenceResponse.model_validate(row)


@router.delete("/evidence/{evidence_id}")
async def delete_evidence(evidence_id: str) -> dict:
    async with SessionLocal() as session:
        row = await _load(session, evidence_id)
        file_path = row.file_path
        control_ids, _ = await _linked_ids(session, evidence_id)
        await session.delete(row)
        await session.flush()
        # Removing evidence may drop a control below 'effective'.
        for cid in control_ids:
            await refresh_control_effectiveness(session, cid)
            await refresh_obligations_for_control(session, cid)
        await session.commit()
    if file_path:
        await minio_client.delete_file(file_path)
    logger.info("evidence.deleted", extra={"evidence_id": evidence_id})
    return {"status": "deleted", "id": evidence_id}


@router.post("/evidence/{evidence_id}/approve", response_model=EvidenceResponse)
async def approve_evidence(evidence_id: str) -> EvidenceResponse:
    return await _set_status(evidence_id, "approved")


@router.post("/evidence/{evidence_id}/reject", response_model=EvidenceResponse)
async def reject_evidence(evidence_id: str) -> EvidenceResponse:
    return await _set_status(evidence_id, "rejected")


async def _set_status(evidence_id: str, status: str) -> EvidenceResponse:
    async with SessionLocal() as session:
        row = await _load(session, evidence_id)
        row.status = status
        row.updated_at = datetime.now(timezone.utc)
        await session.flush()
        await _cascade_from_evidence(session, evidence_id)
        await session.commit()
        await session.refresh(row)
    logger.info("evidence.status_changed", extra={"evidence_id": evidence_id, "status": status})
    return EvidenceResponse.model_validate(row)


async def _cascade_from_evidence(session: AsyncSession, evidence_id: str) -> None:
    """Re-evaluate every control and directly-linked obligation this evidence backs."""
    control_ids = (await session.execute(
        select(evidence_controls.c.control_id).where(evidence_controls.c.evidence_id == evidence_id)
    )).scalars().all()
    for cid in control_ids:
        await refresh_control_effectiveness(session, cid)
        await refresh_obligations_for_control(session, cid)
    # Evidence can also be linked directly to obligations (without a control
    # intermediary). Refresh those too so their status and assessment score stay in sync.
    obligation_ids = (await session.execute(
        select(evidence_obligations.c.obligation_id).where(evidence_obligations.c.evidence_id == evidence_id)
    )).scalars().all()
    for oid in obligation_ids:
        await refresh_obligation(session, oid)


@router.get("/evidence/{evidence_id}/versions", response_model=list[EvidenceVersionResponse])
async def get_evidence_versions(evidence_id: str) -> list[EvidenceVersionResponse]:
    async with SessionLocal() as session:
        await _load(session, evidence_id)
        rows = (await session.execute(
            select(EvidenceVersion)
            .where(EvidenceVersion.evidence_id == evidence_id)
            .order_by(EvidenceVersion.created_at.asc())
        )).scalars().all()
    return [EvidenceVersionResponse.model_validate(r) for r in rows]


@router.post("/evidence/{evidence_id}/upload-version", response_model=EvidenceDetailResponse)
async def upload_evidence_version(
    evidence_id: str,
    version_label: str = Form(...),
    uploaded_by: str = Form(default=""),
    validity_until: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> EvidenceDetailResponse:
    # Validate evidence exists and file type/size before touching MinIO
    async with SessionLocal() as session:
        await _load(session, evidence_id)

    if not file.filename:
        raise HTTPException(422, "File must have a filename")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(422, f"File type '{ext}' is not allowed")
    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(422, f"MIME type '{mime}' is not allowed")
    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, f"File exceeds maximum size of {MAX_FILE_BYTES // (1024 * 1024)} MB")

    # Upload new file to MinIO before the write transaction
    await minio_client.ensure_bucket()
    new_file_path = await minio_client.upload_file(evidence_id, file.filename, data, mime)

    # Write transaction. If it fails, delete the orphaned new file.
    old_file_path = ""
    linked_control_ids: list[str] = []
    linked_obligation_ids: list[str] = []
    try:
        async with SessionLocal() as session:
            row = await _load(session, evidence_id)
            old_file_path = row.file_path

            if row.file_path:
                session.add(EvidenceVersion(
                    id=new_id("EVV"),
                    evidence_id=evidence_id,
                    version_label=row.version_label,
                    file_path=row.file_path,
                    file_name=row.file_name,
                    file_size=row.file_size,
                    mime_type=row.mime_type,
                    uploaded_by=row.uploaded_by,
                ))

            row.file_path = new_file_path
            row.file_name = file.filename
            row.file_size = len(data)
            row.mime_type = mime
            row.uploaded_by = uploaded_by
            row.version_label = version_label
            if validity_until:
                row.validity_until = _parse_date(validity_until, "validity_until")
            row.updated_at = datetime.now(timezone.utc)

            await session.commit()
            await session.refresh(row)
            linked_control_ids, linked_obligation_ids = await _linked_ids(session, evidence_id)
    except Exception:
        await minio_client.delete_file(new_file_path)
        raise

    # Delete the replaced file from MinIO after a successful DB commit
    if old_file_path and old_file_path != new_file_path:
        await minio_client.delete_file(old_file_path)

    logger.info("evidence.version_uploaded", extra={
        "evidence_id": evidence_id, "version_label": version_label,
    })
    detail = EvidenceDetailResponse.model_validate(row)
    detail.control_ids = linked_control_ids
    detail.obligation_ids = linked_obligation_ids
    return detail
