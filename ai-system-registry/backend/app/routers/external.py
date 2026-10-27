"""External read API — a bearer-token-guarded, read-only surface for an
off-platform consumer (e.g. an extracted AI Test Bed repo).

Mounted at ``/v1/external``. Three capabilities:
  - GET  /external/systems[/{id}]          — AI system registration info
  - GET  /external/systems/{id}/assessment — EU AI Act classification + justification
  - POST /external/systems/{id}/context    — search_ai_system_context: document
                                             retrieval scoped to the system
                                             (proxies document-indexing /v1/retrieve)

Auth here is the static bearer token (``require_external_token``), NOT the
platform OpenFGA model. For the retrieval proxy the registry forwards a seeded
service principal (``EXTERNAL_API_SERVICE_PRINCIPAL``) so document-indexing's own
``systems:read`` check passes.

Single-tenant only: the bearer caller carries no tenant OIDC claim, so under
``TENANCY_MODE=jwt`` the tenant middleware fail-closes this whole surface with
401 before any route here runs. That is by design — see ai-system-registry/CLAUDE.md.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Literal

import httpx
from ai_trust_logging import correlation_id_var, get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.external_auth import require_external_token

router = APIRouter(
    prefix="/external",
    tags=["external"],
    dependencies=[Depends(require_external_token)],
)
logger = get_logger(__name__)

_INDEXING_URL = os.environ.get(
    "INDEXING_BACKEND_URL", "http://document-indexing-backend:8011"
).rstrip("/")
_SERVICE_PRINCIPAL = os.environ.get(
    "EXTERNAL_API_SERVICE_PRINCIPAL", "svc-external-api"
)


class ContextRequest(BaseModel):
    """Body for search_ai_system_context — mirrors document-indexing's
    RetrieveRequest minus ai_system_id (which comes from the path)."""

    query: str = Field(..., min_length=1)
    k: int = Field(default=10, ge=1, le=50)
    mode: Literal["dense", "fts", "hybrid"] = "hybrid"
    rrf_k: int = Field(default=60, ge=1, le=200)


class Classification(BaseModel):
    tier: str | None = None
    basis: str | None = None
    annex_iii_area: int | None = None


class SystemAssessmentResponse(BaseModel):
    ai_system_id: str
    classification: Classification
    # The persisted classification rationale (structured JSON), surfaced as the
    # justification for the classification.
    justification: Any | None = None


class ExternalSystemResponse(BaseModel):
    """Explicit allowlist of the registration fields exposed on the external
    read API — **never** the full internal ``AISystemResponse``.

    Published: the descriptive registration fields, the questionnaire answers,
    the EU AI Act classifier flags + headline ``tier``, and ``git_repo_url`` —
    i.e. the data an off-platform consumer (the AI Test Bed) needs to read or
    re-run a classification.

    Deliberately withheld (internal operator state, not part of the data
    contract): assignee/owner usernames and ``git`` *owners* (PII),
    ``registration_documents`` (MinIO object keys), ``field_confirmations``
    (UI state), ``workflow_status`` / ``info_requested_section`` /
    ``registration_mode`` (governance state), the ``compliance`` score, and the
    classification *detail* ``basis`` / ``annex_iii_area`` /
    ``classification_rationale`` (served separately by ``/assessment``). Adding a
    field to the external contract is a conscious edit here, so new internal
    columns are never silently published.
    """

    id: str
    name: str
    version: str
    provider: str
    org_name: str
    org_role: str
    description: str
    intended_purpose: str
    department: str | None
    use_case: str | None
    people_affected: str | None
    decision_context: str | None
    system_type: str
    autonomy_level: str
    application_url: str
    provider_country: str
    deployment_country: str | None
    eu_output_usage: bool | None
    eu_market_placement: bool | None
    lifecycle: str
    tier: str
    # EU AI Act classifier flags (inputs to the deterministic classifier).
    subliminal_manipulation: bool
    exploits_vulnerability: bool
    social_scoring_public: bool
    real_time_biometric_public: bool
    emotion_recognition_workplace: bool
    untargeted_facial_scraping: bool
    predictive_policing: bool
    biometric_categorisation_sensitive: bool
    is_biometric_identification: bool
    is_critical_infrastructure: bool
    is_education_related: bool
    is_employment_related: bool
    is_credit_scoring: bool
    is_public_service: bool
    is_law_enforcement: bool
    is_migration: bool
    is_judicial_admin: bool
    is_gpai: bool
    training_compute_flops: float
    is_chatbot: bool
    generates_synthetic_content: bool
    questionnaire_answers: dict | None
    git_repo_url: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


async def _ensure_system_exists(system_id: str) -> None:
    """404 if ``system_id`` is unknown. Used by routes that don't need the row
    itself (only its existence) — e.g. the retrieval proxy. Routes that *do*
    read columns must open their own session and validate inside it, so the row
    is not accessed after the session closes (detached-instance trap)."""
    async with SessionLocal() as session:
        result = await session.execute(
            select(AISystem.id).where(AISystem.id == system_id)
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(404, f"System {system_id} not found")


@router.get("/systems", response_model=list[ExternalSystemResponse])
async def list_systems(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ExternalSystemResponse]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(AISystem)
            .order_by(AISystem.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return [
            ExternalSystemResponse.model_validate(r) for r in result.scalars().all()
        ]


@router.get("/systems/{system_id}", response_model=ExternalSystemResponse)
async def get_system(system_id: str) -> ExternalSystemResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        return ExternalSystemResponse.model_validate(row)


@router.get("/systems/{system_id}/assessment", response_model=SystemAssessmentResponse)
async def get_system_assessment(system_id: str) -> SystemAssessmentResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        return SystemAssessmentResponse(
            ai_system_id=system_id,
            classification=Classification(
                tier=row.tier, basis=row.basis, annex_iii_area=row.annex_iii_area
            ),
            justification=row.classification_rationale,
        )


@router.post("/systems/{system_id}/context", response_model=None)
async def search_ai_system_context(system_id: str, body: ContextRequest) -> Any:
    await _ensure_system_exists(system_id)
    payload = {"ai_system_id": system_id, **body.model_dump()}
    headers = {"x-forwarded-preferred-username": _SERVICE_PRINCIPAL}
    cid = correlation_id_var.get("")
    if cid:
        headers["x-correlation-id"] = cid

    url = f"{_INDEXING_URL}/v1/retrieve"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        logger.error("external.retrieve.timeout", extra={"url": url})
        raise HTTPException(status_code=504, detail="Retrieval timed out") from exc
    except httpx.RequestError as exc:
        logger.error(
            "external.retrieve.unreachable", extra={"url": url, "error": str(exc)}
        )
        raise HTTPException(
            status_code=502, detail="Retrieval service unavailable"
        ) from exc

    if resp.status_code in (401, 403):
        logger.error(
            "external.retrieve.authz_failed", extra={"status": resp.status_code}
        )
        raise HTTPException(
            status_code=502,
            detail="Retrieval authorization failed (service principal mis-seeded)",
        )
    if resp.status_code >= 400:
        logger.error("external.retrieve.error", extra={"status": resp.status_code})
        raise HTTPException(
            status_code=502, detail=f"Retrieval returned {resp.status_code}"
        )
    return resp.json()
