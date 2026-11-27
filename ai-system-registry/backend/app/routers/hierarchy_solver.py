"""POST /v1/systems/{system_id}/classification/resolve — hierarchy solver.

Reads the latest classification run from MinIO, applies optional user overrides,
resolves the risk hierarchy to a single winner, and returns confidence bands for
all labels. Stateless — nothing is written to the database.
"""

from __future__ import annotations

from ai_trust_authorization.permissions import require_permission
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from app.hierarchy_solver import resolve_latest_for_system
from app.schemas.hierarchy_solver import LabelOverrides, ResolveResponse
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

router = APIRouter(tags=["assessment"])


@router.post(
    "/systems/{system_id}/classification/resolve",
    response_model=ResolveResponse,
    summary="Resolve risk/role classification with optional user overrides",
    responses={
        404: {"description": "System not found or no classification run exists yet."},
        422: {
            "description": "Unknown label in overrides, riskWinner is not a risk label, or unknown questionId in answers."
        },
    },
    dependencies=[Depends(require_permission("systems:read"))],
)
async def resolve_classification(
    system_id: str,
    body: LabelOverrides | None = None,
) -> ResolveResponse:
    """Resolve the latest classification run for a system.

    Reads the most recent MinIO classification result, applies ``overrides``
    (per-question answer re-evaluation, per-label bool, or direct ``riskWinner``),
    resolves the risk hierarchy to one winner, and returns confidence bands for
    all labels. Every call is stateless — safe to call on each UI interaction.
    """
    async with SessionLocal() as session:
        exists = (
            await session.execute(select(AISystem.id).where(AISystem.id == system_id))
        ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(404, f"AI system '{system_id}' not found")

    try:
        return await resolve_latest_for_system(system_id, body)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
