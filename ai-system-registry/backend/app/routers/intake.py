"""POST /api/v1/intake — register an AI system (name + description only)."""

from __future__ import annotations

import json

from ai_trust_authorization import check_permission, require_permission
from ai_trust_authorization.constants import SYSTEMS_APPROVE, SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.audit import log_audit_event
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep
from app import email_sender
from app.classifier import ClassificationResult
from app.ids import new_id
from app.schemas import AISystemCreate, AISystemResponse, IntakeResponse
from app.schemas.ai_system import AISystemImport, ImportFailure, ImportResult
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from pydantic import ValidationError

router = APIRouter(tags=["intake"])
logger = get_logger(__name__)

MAX_IMPORT_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_IMPORT_RECORDS = 1000


@router.post(
    "/intake",
    response_model=IntakeResponse,
    status_code=201,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def intake_system(
    body: AISystemCreate, request: Request, background_tasks: BackgroundTasks
) -> IntakeResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")
    system_id = new_id("SYS")
    step_id = new_id("SWS")

    row = AISystem(
        id=system_id,
        name=body.name,
        description=body.description,
        intended_purpose=body.intended_purpose or "",
        business_owners=body.business_owners,
        technical_owners=body.technical_owners,
        git_repo_url=body.git_repo_url,
        deployment_country=body.deployment_country,
        eu_output_usage=body.eu_output_usage,
        eu_market_placement=body.eu_market_placement,
        tier="pending",
        basis="Pending risk classification",
        annex_iii_area=None,
        compliance=0.0,
        workflow_status="draft",
        org_role=body.org_role or "provider",
        registration_mode="ai",
    )

    step = SystemWorkflowStep(
        id=step_id,
        system_id=system_id,
        step="registered",
        actor_username=current_user,
        assignee_username=None,
    )

    async with SessionLocal() as session:
        session.add(row)
        session.add(step)
        log_audit_event(
            session,
            actor=current_user,
            action="system.registered",
            resource_type="ai_system",
            resource_id=system_id,
            ai_system_id=system_id,
            ai_system_name=body.name,
        )
        await session.commit()
        await session.refresh(row)

    logger.info(
        "system.registered", extra={"system_id": row.id, "system_name": row.name}
    )

    if body.assignee_username:
        background_tasks.add_task(
            email_sender.notify,
            to_username=body.assignee_username,
            subject=f"[{{platform_name}}] System '{row.name}' assigned to you for details",
            body=(
                f"Hi,\n\n"
                f"You have been assigned to complete the technical details for the AI system '{row.name}' ({row.id}).\n\n"
                "Please log in to {platform_name} and open the system to fill in the required information.\n\n"
                "{platform_name}: {registry_url}"
            ),
        )

    classification = ClassificationResult(
        tier="pending",
        basis="Pending risk classification",
        obligations=[],
        annex_iii_area=None,
    )
    return IntakeResponse(
        system=AISystemResponse.model_validate(row), classification=classification
    )


@router.post(
    "/intake/batch",
    response_model=ImportResult,
    status_code=200,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def import_systems(
    request: Request,
    file: UploadFile = File(...),
    target_status: str = Form("draft"),
) -> ImportResult:
    """Batch-import AI systems from a JSON file.

    Accepts a JSON array of AISystemImport objects (see docs/batch-import-format.md).
    Validates each record independently; valid ones are inserted, invalid ones are
    reported.  target_status is a ceiling: a tier-less record always lands as draft.
    """
    if target_status not in ("approved", "draft"):
        raise HTTPException(
            status_code=422, detail="target_status must be 'approved' or 'draft'"
        )

    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")

    if target_status == "approved" and not await check_permission(
        current_user, SYSTEMS_APPROVE
    ):
        raise HTTPException(
            status_code=403,
            detail="systems:approve permission required to import as approved",
        )

    # --- Size cap (mirror systems.py document-upload pattern) ---
    content_length = request.headers.get("content-length")
    if (
        content_length
        and content_length.isdigit()
        and int(content_length) > MAX_IMPORT_SIZE
    ):
        raise HTTPException(status_code=413, detail="Import file exceeds 10 MB limit")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Upload file is empty")
    if len(data) > MAX_IMPORT_SIZE:
        raise HTTPException(status_code=413, detail="Import file exceeds 10 MB limit")

    # --- Parse ---
    try:
        records = json.loads(data)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON: {e}") from e
    if not isinstance(records, list):
        raise HTTPException(status_code=422, detail="JSON root must be an array")
    if len(records) > MAX_IMPORT_RECORDS:
        raise HTTPException(
            status_code=413,
            detail=f"Batch exceeds {MAX_IMPORT_RECORDS} records",
        )

    # --- Validate all records first, collect failures ---
    valid: list[tuple[int, AISystemImport]] = []
    failed: list[ImportFailure] = []
    for i, item in enumerate(records):
        try:
            rec = AISystemImport.model_validate(item)
            valid.append((i, rec))
        except ValidationError as e:
            failed.append(
                ImportFailure(
                    index=i,
                    name=item.get("name") if isinstance(item, dict) else None,
                    error=str(e),
                )
            )

    # --- Insert all valid records in one transaction ---
    rows: list[AISystem] = []
    steps: list[SystemWorkflowStep] = []
    for i, rec in valid:
        tier = rec.tier or "pending"
        if target_status == "approved" and tier == "pending":
            failed.append(
                ImportFailure(
                    index=i,
                    name=rec.name,
                    error="tier is pending; supply a classified tier to import as approved",
                )
            )
            continue
        workflow_status = "approved" if target_status == "approved" else "draft"
        system_id = new_id("SYS")

        row = AISystem(
            id=system_id,
            name=rec.name,
            version=rec.version or "1.0.0",
            provider=rec.provider or "",
            org_name=rec.org_name or "",
            org_role=rec.org_role,
            description=rec.description or "",
            intended_purpose=rec.intended_purpose or "",
            department=rec.department,
            use_case=rec.use_case,
            people_affected=rec.people_affected,
            decision_context=rec.decision_context,
            system_type=rec.system_type or "application",
            autonomy_level=rec.autonomy_level or "decision_support",
            application_url=rec.application_url or "",
            provider_country=rec.provider_country or "DE",
            deployment_country=rec.deployment_country,
            eu_output_usage=rec.eu_output_usage,
            eu_market_placement=rec.eu_market_placement,
            lifecycle=rec.lifecycle or "development",
            business_owners=rec.business_owners,
            technical_owners=rec.technical_owners,
            git_repo_url=rec.git_repo_url,
            tier=tier,
            basis=rec.basis or "",
            annex_iii_area=rec.annex_iii_area,
            compliance=0.0,
            workflow_status=workflow_status,
            registration_mode="full_manual",
            # Classifier flags (evidential, optional)
            subliminal_manipulation=rec.subliminal_manipulation or False,
            exploits_vulnerability=rec.exploits_vulnerability or False,
            social_scoring_public=rec.social_scoring_public or False,
            real_time_biometric_public=rec.real_time_biometric_public or False,
            emotion_recognition_workplace=rec.emotion_recognition_workplace or False,
            untargeted_facial_scraping=rec.untargeted_facial_scraping or False,
            predictive_policing=rec.predictive_policing or False,
            biometric_categorisation_sensitive=rec.biometric_categorisation_sensitive
            or False,
            is_biometric_identification=rec.is_biometric_identification or False,
            is_critical_infrastructure=rec.is_critical_infrastructure or False,
            is_education_related=rec.is_education_related or False,
            is_employment_related=rec.is_employment_related or False,
            is_credit_scoring=rec.is_credit_scoring or False,
            is_public_service=rec.is_public_service or False,
            is_law_enforcement=rec.is_law_enforcement or False,
            is_migration=rec.is_migration or False,
            is_judicial_admin=rec.is_judicial_admin or False,
            is_gpai=rec.is_gpai or False,
            training_compute_flops=rec.training_compute_flops or 0.0,
            is_chatbot=rec.is_chatbot or False,
            generates_synthetic_content=rec.generates_synthetic_content or False,
            # JSONB audit/workflow fields: never imported — always NULL
            classification_rationale=None,
            field_confirmations=None,
            questionnaire_answers=None,
            registration_documents=None,
        )
        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="imported",
            actor_username=current_user,
            assignee_username=None,
        )
        rows.append(row)
        steps.append(step)

    async with SessionLocal() as session:
        session.add_all(rows)
        session.add_all(steps)
        for row in rows:
            log_audit_event(
                session,
                actor=current_user,
                action="system.imported",
                resource_type="ai_system",
                resource_id=row.id,
                ai_system_id=row.id,
                ai_system_name=row.name,
                source="import",
            )
        await session.commit()

    logger.info("systems.imported", extra={"count": len(rows), "failed": len(failed)})
    return ImportResult(imported=len(rows), failed=failed)
