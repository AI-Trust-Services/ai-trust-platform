"""POST /v1/systems/{system_id}/classification/resolve — hierarchy solver.

Reads the latest classification run from MinIO, applies optional user overrides,
resolves the risk hierarchy to a single winner, and returns confidence bands for
all labels. Stateless — nothing is written to the database.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from ai_trust_authorization.permissions import require_permission
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from sqlalchemy import select

from app import minio_client
from app.classification_config import DEFAULT_CLASSIFICATION_CONFIG_ID
from app.hierarchy_solver import solve
from app.schemas.hierarchy_solver import LabelOverrides, ResolveResponse

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

    pipeline_result = await minio_client.list_latest_classification(
        system_id, DEFAULT_CLASSIFICATION_CONFIG_ID
    )
    if pipeline_result is None:
        raise HTTPException(404, "No classification run found for this system")

    # only load the questionnaire result when answers overrides are present — the solver
    # needs the base answer map only for re-evaluation; labels/riskWinner don't need it
    questionnaire_result = None
    if body and body.answers:
        questionnaire_run_key = pipeline_result.get("questionnaire_run_key")
        if not questionnaire_run_key:
            raise RuntimeError(
                f"Classification run for system '{system_id}' has no questionnaire_run_key — "
                "cannot re-evaluate answers without the questionnaire result."
            )
        questionnaire_result = await minio_client.get_json(questionnaire_run_key)

    try:
        return solve(pipeline_result, body, questionnaire_result)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
