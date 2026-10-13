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
"""

from __future__ import annotations

import os
from typing import Any, Literal

import httpx
from ai_trust_logging import correlation_id_var, get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.external_auth import require_external_token
from app.schemas import AISystemResponse

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


async def _get_system_or_404(system_id: str) -> AISystem:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        return row


@router.get("/systems", response_model=list[AISystemResponse])
async def list_systems(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AISystemResponse]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(AISystem)
            .order_by(AISystem.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return [AISystemResponse.model_validate(r) for r in result.scalars().all()]


@router.get("/systems/{system_id}", response_model=AISystemResponse)
async def get_system(system_id: str) -> AISystemResponse:
    return AISystemResponse.model_validate(await _get_system_or_404(system_id))


@router.get("/systems/{system_id}/assessment", response_model=SystemAssessmentResponse)
async def get_system_assessment(system_id: str) -> SystemAssessmentResponse:
    row = await _get_system_or_404(system_id)
    return SystemAssessmentResponse(
        ai_system_id=system_id,
        classification=Classification(
            tier=row.tier, basis=row.basis, annex_iii_area=row.annex_iii_area
        ),
        justification=row.classification_rationale,
    )


@router.post("/systems/{system_id}/context", response_model=None)
async def search_ai_system_context(system_id: str, body: ContextRequest) -> Any:
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
