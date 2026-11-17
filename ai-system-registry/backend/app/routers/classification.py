"""POST /v1/systems/{system_id}/classification-llm-run — pipeline 2 (classification).

Triggers the risk & role classification pipeline
(``app/classification_pipeline.py``) against a questionnaire result already stored
in MinIO. It is the same function the assessment prefill runs right after the
questionnaire step; here it is called on its own with the ``run_key`` returned by
``POST /questionnaire-llm-run``.
"""

from __future__ import annotations

from ai_trust_authorization.permissions import require_permission
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.classification_pipeline import (
    DEFAULT_CLASSIFICATION_CONFIG_ID,
    DEFAULT_CLASSIFICATION_PROMPT_ID,
    run_classification,
)
from app.routers.pipeline_errors import map_pipeline_error
from app.schemas.pipeline import PipelineStepOutput

router = APIRouter(tags=["assessment"])

# One optional sub-folder level, e.g. "risk_classification/risk_role_classification".
_ID_PATTERN = r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?$"


class ClassificationRunRequest(BaseModel):
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "questionnaire_run_key": "questionnaire-results/SYS-AB12CD34/"
                    "ai-questionnaire/2026-11-03T14-22-01-000000Z.json"
                }
            ]
        }
    }

    questionnaire_run_key: str = Field(
        min_length=1,
        max_length=512,
        description="MinIO key of this system's questionnaire result "
        "(the run_key returned by /questionnaire-llm-run).",
    )
    classification_config_id: str = Field(
        default=DEFAULT_CLASSIFICATION_CONFIG_ID,
        pattern=_ID_PATTERN,
        max_length=200,
        description="ID of the classification config file under context/prompts/.",
    )
    prompt_id: str = Field(
        default=DEFAULT_CLASSIFICATION_PROMPT_ID,
        pattern=_ID_PATTERN,
        max_length=200,
        description="ID of the classification system prompt file under context/prompts/.",
    )


@router.post(
    "/systems/{system_id}/classification-llm-run",
    response_model=PipelineStepOutput,
    summary="Run the risk & role classification LLM pipeline (pipeline 2)",
    responses={
        404: {
            "description": "System, stored questionnaire result, config file or "
            "prompt file not found."
        },
        422: {
            "description": "questionnaire_run_key is not a questionnaire result of "
            "this system, or an id has an invalid format."
        },
    },
    dependencies=[Depends(require_permission("systems:write"))],
)
async def trigger_classification_llm_run(
    system_id: str,
    body: ClassificationRunRequest,
) -> PipelineStepOutput:
    """Run pipeline 2 against a stored questionnaire result.

    Pass the ``run_key`` returned by ``POST /questionnaire-llm-run`` as
    ``questionnaire_run_key``. One validated LLM call runs per active label; a label
    is skipped when the answers it depends on are missing, and a label whose call
    fails is omitted. Returns the MinIO key, a 24-hour presigned URL, and the full
    classification result.

    This is exactly the classification step the assessment prefill runs after its
    questionnaire step.
    """
    async with SessionLocal() as session:
        exists = (
            await session.execute(select(AISystem.id).where(AISystem.id == system_id))
        ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=404, detail=f"AI system '{system_id}' not found"
        )

    try:
        output = await run_classification(
            system_id=system_id,
            questionnaire_run_key=body.questionnaire_run_key,
            classification_config_id=body.classification_config_id,
            prompt_id=body.prompt_id,
        )
    except Exception as exc:  # noqa: BLE001 — mapped or re-raised below
        raise map_pipeline_error(exc) from exc

    return PipelineStepOutput(**output)
