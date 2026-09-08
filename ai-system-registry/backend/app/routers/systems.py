from __future__ import annotations

import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE, SYSTEMS_APPROVE
from ai_trust_logging import get_logger
from app.classifier import classify, CLASSIFIER_INPUTS
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.audit import log_audit_event
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.model_card import ModelCard
from ai_trust_persistence.models.ai_system_model_card import AISystemModelCard
from app import minio_client
from app.routers.workflow import _active_sub_assignment, _get_steps
from app.schemas import (
    AISystemResponse,
    AISystemUpdate,
    DownloadUrlResponse,
    IntakeResponse,
    SystemModelLinkBody,
    SystemModelResponse,
    QuestionnaireAnswersPatch,
    RegistrationDocument,
    VALID_LIFECYCLES,
    VALID_ROLES,
)

router = APIRouter(tags=["systems"])
logger = get_logger(__name__)

_IMMUTABLE_FIELDS = frozenset({"tier", "basis", "annex_iii_area"})

# Supporting documents accepted for full-manual registration (extension allowlist).
_ALLOWED_DOC_EXTENSIONS = frozenset({
    ".pdf", ".doc", ".docx", ".txt", ".md", ".ppt", ".pptx",
    ".xls", ".xlsx", ".csv", ".png", ".jpg", ".jpeg",
})

# The pending status each questionnaire section may be edited in, plus the assignee
# column that owns it.
_SECTION_STATUS = {"business": "business_pending", "technical": "technical_pending"}


async def _assert_can_edit_section(session, row: AISystem, section: str, current_user: str) -> None:
    """Enforce the section edit-lock: while a sub-assignment is active, only the
    contributor holding the token may edit; otherwise only the section owner may.

    A ``None`` holder (e.g. an unassigned draft) imposes no restriction so the
    creator can still fill things in before assigning."""
    steps = await _get_steps(session, row.id)
    holder = _active_sub_assignment(steps, section)
    if holder is None:
        holder = row.business_assignee_username if section == "business" else row.technical_assignee_username
    if holder and current_user != holder:
        raise HTTPException(403, f"The '{section}' section is currently assigned to {holder}")


@router.get("/systems", response_model=list[AISystemResponse], dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def list_systems(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AISystemResponse]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(AISystem).order_by(AISystem.created_at.desc()).limit(limit).offset(offset)
        )
        return [AISystemResponse.model_validate(r) for r in result.scalars().all()]


@router.get("/systems/{system_id}", response_model=AISystemResponse, dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def get_system(system_id: str) -> AISystemResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        return AISystemResponse.model_validate(row)


@router.put("/systems/{system_id}", response_model=AISystemResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def update_system(system_id: str, body: AISystemUpdate, request: Request) -> AISystemResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")
    updates = body.model_dump(exclude_none=True)

    immutable_attempted = _IMMUTABLE_FIELDS & updates.keys()
    if immutable_attempted:
        raise HTTPException(422, f"Fields are immutable (use /reclassify): {sorted(immutable_attempted)}")

    if body.lifecycle and body.lifecycle not in VALID_LIFECYCLES:
        raise HTTPException(422, f"Invalid lifecycle '{body.lifecycle}'")
    if body.org_role and body.org_role not in VALID_ROLES:
        raise HTTPException(422, f"Invalid org_role '{body.org_role}'")

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")

        flag_updates = CLASSIFIER_INPUTS & updates.keys()
        technical_section_edit = bool(flag_updates) and row.workflow_status == "technical_pending"

        if technical_section_edit:
            # Manual-questionnaire mode: the technical section is a checkbox form. Who may
            # fill it is governed by the section edit-lock (owner, or the active
            # sub-assignee) — this supersedes the plain workflow-level assignee guard.
            await _assert_can_edit_section(session, row, "technical", current_user)
        elif row.assignee_username and current_user != row.assignee_username:
            raise HTTPException(403, "Only the assigned user may update this system")

        if flag_updates and row.workflow_status not in ("draft", "rejected", "technical_pending"):
            raise HTTPException(422, "Risk flags can only be changed while the system is in draft, rejected, or technical_pending state")

        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)

        if flag_updates:
            classification = classify(row)
            row.tier = classification.tier
            row.basis = classification.basis
            row.annex_iii_area = classification.annex_iii_area

        await session.commit()
        await session.refresh(row)

    logger.info("system.updated", extra={"system_id": system_id, "fields": sorted(updates.keys())})
    return AISystemResponse.model_validate(row)


@router.delete("/systems/{system_id}", dependencies=[Depends(require_permission(SYSTEMS_APPROVE))])
async def delete_system(system_id: str, request: Request) -> dict:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        name = row.name
        await session.delete(row)
        log_audit_event(
            session,
            actor=current_user,
            action="system.deleted",
            resource_type="ai_system",
            resource_id=system_id,
            ai_system_id=system_id,
            ai_system_name=name,
        )
        await session.commit()
    logger.info("system.deleted", extra={"system_id": system_id, "system_name": name})
    return {"status": "deleted", "id": system_id, "name": name}


@router.post("/systems/{system_id}/reclassify", response_model=IntakeResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def reclassify_system(system_id: str, request: Request) -> IntakeResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")

        old_tier = row.tier
        classification = classify(row)

        row.tier = classification.tier
        row.basis = classification.basis
        row.annex_iii_area = classification.annex_iii_area
        row.updated_at = datetime.now(timezone.utc)

        log_audit_event(
            session,
            actor=current_user,
            action="system.reclassified",
            resource_type="ai_system",
            resource_id=system_id,
            ai_system_id=system_id,
            ai_system_name=row.name,
            changes={"tier": {"before": old_tier, "after": classification.tier}} if old_tier != classification.tier else None,
        )
        await session.commit()
        await session.refresh(row)

    logger.info("system.reclassified", extra={
        "system_id": system_id,
        "old_tier": old_tier,
        "new_tier": classification.tier,
        "basis": classification.basis,
    })

    return IntakeResponse(
        system=AISystemResponse.model_validate(row),
        classification=classification,
    )


@router.get("/systems/{system_id}/models", response_model=list[SystemModelResponse], dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def list_system_models(system_id: str) -> list[SystemModelResponse]:
    async with SessionLocal() as session:
        sys_result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not sys_result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")

        result = await session.execute(
            select(ModelCard, AISystemModelCard.__table__.c.role)
            .join(AISystemModelCard.__table__, ModelCard.id == AISystemModelCard.__table__.c.model_card_id)
            .where(AISystemModelCard.__table__.c.system_id == system_id)
            .order_by(ModelCard.name)
        )
        return [
            SystemModelResponse.from_card(card, role)
            for card, role in result.all()
        ]


@router.post("/systems/{system_id}/models", response_model=SystemModelResponse, status_code=200, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def add_system_model(system_id: str, body: SystemModelLinkBody) -> SystemModelResponse:
    # Upsert: creates the link on first call, updates role on repeat. Always 200 —
    # distinguishing insert from update requires xmax trickery the frontend doesn't need.
    async with SessionLocal() as session:
        sys_result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not sys_result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")

        mdl_result = await session.execute(select(ModelCard).where(ModelCard.id == body.model_card_id))
        card = mdl_result.scalar_one_or_none()
        if not card:
            raise HTTPException(404, f"Model card {body.model_card_id} not found")

        await session.execute(
            pg_insert(AISystemModelCard.__table__)
            .values(system_id=system_id, model_card_id=body.model_card_id, role=body.role)
            .on_conflict_do_update(
                index_elements=["system_id", "model_card_id"],
                set_={"role": body.role},
            )
        )
        await session.commit()
        response = SystemModelResponse.from_card(card, body.role)

    logger.info("system.model_linked", extra={"system_id": system_id, "model_card_id": body.model_card_id, "role": body.role})
    return response


@router.delete("/systems/{system_id}/models/{model_card_id}", dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def remove_system_model(system_id: str, model_card_id: str) -> dict:
    async with SessionLocal() as session:
        result = await session.execute(
            delete(AISystemModelCard.__table__)
            .where(AISystemModelCard.__table__.c.system_id == system_id)
            .where(AISystemModelCard.__table__.c.model_card_id == model_card_id)
            .returning(AISystemModelCard.__table__.c.model_card_id)
        )
        if not result.fetchone():
            raise HTTPException(404, f"Link between {system_id} and {model_card_id} not found")
        await session.commit()

    logger.info("system.model_unlinked", extra={"system_id": system_id, "model_card_id": model_card_id})
    return {"status": "unlinked", "system_id": system_id, "model_card_id": model_card_id}


@router.patch("/systems/{system_id}/questionnaire", response_model=AISystemResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def patch_questionnaire_answers(system_id: str, body: QuestionnaireAnswersPatch, request: Request) -> AISystemResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")

        # Business answers are editable in draft (creator pre-fill) or business_pending;
        # technical answers only in technical_pending. The section edit-lock then decides
        # who (owner vs active sub-assignee) may actually write.
        allowed_states = ("draft", "business_pending") if body.section == "business" else ("technical_pending",)
        if row.workflow_status not in allowed_states:
            raise HTTPException(
                422,
                f"The '{body.section}' section can only be updated while the system is in "
                f"{' or '.join(allowed_states)} state",
            )
        await _assert_can_edit_section(session, row, body.section, current_user)

        answers = dict(row.questionnaire_answers or {})
        if body.section == "technical":
            technical = dict(answers.get("technical") or {})
            technical.update(body.answers)
            answers["technical"] = technical
        else:
            answers.update(body.answers)
        row.questionnaire_answers = answers
        row.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(row)

    logger.info("system.questionnaire_updated", extra={
        "system_id": system_id, "section": body.section, "keys": sorted(body.answers.keys()),
    })
    return AISystemResponse.model_validate(row)


@router.post("/systems/{system_id}/documents", response_model=AISystemResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def upload_registration_document(
    system_id: str,
    request: Request,
    file: UploadFile = File(...),
) -> AISystemResponse:
    """Attach a supporting document to a full-manual registration.

    Stored in the ``registration-docs`` MinIO bucket; a metadata entry is appended to
    the system's ``registration_documents`` JSONB array."""
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")

    filename = os.path.basename(file.filename or "").strip()
    if not filename:
        raise HTTPException(422, "A filename is required")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _ALLOWED_DOC_EXTENSIONS:
        raise HTTPException(422, f"Unsupported file type '{ext}'. Allowed: {sorted(_ALLOWED_DOC_EXTENSIONS)}")

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.registration_mode != "full_manual":
            raise HTTPException(422, "Supporting documents may only be uploaded for full-manual registrations")

    data = await file.read()
    if not data:
        raise HTTPException(422, "The uploaded file is empty")

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()

        key = await minio_client.upload_file(system_id, filename, data, file.content_type or "application/octet-stream")

        try:
            docs = list(row.registration_documents or [])
            docs.append(RegistrationDocument(
                filename=filename,
                minio_key=key,
                uploaded_at=datetime.now(timezone.utc),
            ).model_dump(mode="json"))
            row.registration_documents = docs
            row.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(row)
        except Exception:
            await minio_client.delete_file(key)
            raise

    logger.info("system.document_uploaded", extra={
        "system_id": system_id, "file_name": filename, "by": current_user,
    })
    return AISystemResponse.model_validate(row)


@router.get("/systems/{system_id}/documents/{doc_index}/download-url", response_model=DownloadUrlResponse, dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def get_document_download_url(system_id: str, doc_index: int) -> DownloadUrlResponse:
    """Return a short-lived presigned GET URL for a registration document by array index."""
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")

        docs = row.registration_documents or []
        if doc_index < 0 or doc_index >= len(docs):
            raise HTTPException(404, f"Document {doc_index} not found for system {system_id}")
        key = docs[doc_index]["minio_key"]

    url = await minio_client.get_presigned_url(key)
    return DownloadUrlResponse(url=url)

