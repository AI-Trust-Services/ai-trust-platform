"""POST /v1/systems/{system_id}/questionnaire-llm-run — pipeline 1 (questionnaire).

Triggers the questionnaire answer pipeline (``app/questionnaire_pipeline.py``) for
an AI system. It is the same function the assessment prefill runs when a user
starts an assessment; here no per-batch callback is passed, so nothing is written
to the assessment — the endpoint only returns the stored result.

Defaults (shared constants, identical to what the assessment runs):
  questionnaire_id: "ai-questionnaire"  → context/prompts/ai-questionnaire.json
  prompt_id:        "questionnaire_answer" → context/prompts/questionnaire_answer.md
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ai_trust_authorization.permissions import require_permission
from app.questionnaire_pipeline import (
    DEFAULT_QUESTIONNAIRE_ID,
    DEFAULT_QUESTIONNAIRE_PROMPT_ID,
    run_questionnaire_pipeline,
)
from app.routers.pipeline_errors import map_pipeline_error
from app.schemas.pipeline import PipelineStepOutput

router = APIRouter(tags=["assessment"])


class QuestionnaireRunRequest(BaseModel):
    model_config = {
        "json_schema_extra": {
            "examples": [
                {},
                {
                    "questionnaire_id": DEFAULT_QUESTIONNAIRE_ID,
                    "prompt_id": DEFAULT_QUESTIONNAIRE_PROMPT_ID,
                },
            ]
        }
    }

    questionnaire_id: str = Field(
        default=DEFAULT_QUESTIONNAIRE_ID,
        pattern=r"^[A-Za-z0-9_-]+$",
        max_length=100,
        description="ID of the questionnaire file in context/prompts/<id>.json",
    )
    prompt_id: str = Field(
        default=DEFAULT_QUESTIONNAIRE_PROMPT_ID,
        pattern=r"^[A-Za-z0-9_-]+$",
        max_length=100,
        description="ID of the system prompt file in context/prompts/<id>.md",
    )


@router.post(
    "/systems/{system_id}/questionnaire-llm-run",
    response_model=PipelineStepOutput,
    summary="Run the questionnaire LLM pipeline (pipeline 1)",
    responses={
        404: {"description": "System, questionnaire file or prompt file not found."},
        502: {
            "description": "No questionnaire batch produced a valid LLM result "
            "after the validation retries."
        },
    },
    dependencies=[Depends(require_permission("systems:write"))],
)
async def trigger_questionnaire_llm_run(
    system_id: str,
    body: QuestionnaireRunRequest,
    request: Request,
) -> PipelineStepOutput:
    """Run pipeline 1 for an AI system and store the result in MinIO.

    Builds the evidence (registration data + RAG documents), answers the
    questionnaire with one validated LLM call per dependency group, and returns the
    MinIO key, a 24-hour presigned URL, and the full ``{"results": [...]}``.

    This is exactly the questionnaire step the assessment prefill runs, minus its
    persistence hooks: it does **not** write assessment answers and does **not**
    run the classification (use ``/classification-llm-run`` with the returned
    ``run_key`` for that).
    """
    username = request.headers.get("x-forwarded-preferred-username", "anonymous")

    try:
        output = await run_questionnaire_pipeline(
            system_id=system_id,
            questionnaire_id=body.questionnaire_id,
            prompt_id=body.prompt_id,
            username=username,
        )
    except Exception as exc:  # noqa: BLE001 — mapped or re-raised below
        raise map_pipeline_error(exc) from exc

    return PipelineStepOutput(**output)
