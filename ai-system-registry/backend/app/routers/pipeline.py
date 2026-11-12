"""Pipeline orchestration endpoints.

Explicit step-by-step and full-pipeline triggers for the LLM classification
pipeline. Each step can be called individually or composed via /pipeline-run.

  POST /v1/systems/{id}/classification-run  — Step 2 only (reads Step 1 MinIO output)
  POST /v1/systems/{id}/pipeline-run        — Step 1 → Step 2 in sequence

Designed to be extended: issue #371 adds Step 3 (hierarchy resolver) as a new
endpoint + a third key in the PipelineRunResponse.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ai_trust_authorization.permissions import require_permission
from ai_trust_logging import get_logger
from app.classification_pipeline import run_classification
from app.llm.parsing import LLMParseError
from app.llm.templates import PromptTemplateError
from app.questionnaire_pipeline import run_pipeline

router = APIRouter(tags=["assessment"])
logger = get_logger(__name__)

_DEFAULT_QUESTIONNAIRE_ID = "ai-questionnaire"
_DEFAULT_QUESTIONNAIRE_PROMPT_ID = "questionnaire_answer"
_DEFAULT_CLASSIFICATION_CONFIG_ID = (
    "risk_classification/risk_role_classification_config"
)
_DEFAULT_CLASSIFICATION_PROMPT_ID = "risk_classification/risk_role_classification"


class ClassificationRunRequest(BaseModel):
    questionnaire_run_key: str = Field(
        description="MinIO key of the Step 1 questionnaire result (from questionnaire-run response).",
    )
    classification_config_id: str = Field(
        default=_DEFAULT_CLASSIFICATION_CONFIG_ID,
        description="ID of the classification config file under context/prompts/.",
    )
    prompt_id: str = Field(
        default=_DEFAULT_CLASSIFICATION_PROMPT_ID,
        description="ID of the LLM 2 system prompt file under context/prompts/.",
    )


class ClassificationRunResponse(BaseModel):
    run_key: str
    presigned_url: str
    result: dict


class PipelineRunRequest(BaseModel):
    questionnaire_id: str = Field(
        default=_DEFAULT_QUESTIONNAIRE_ID,
        pattern=r"^[A-Za-z0-9_-]+$",
        max_length=100,
    )
    questionnaire_prompt_id: str = Field(
        default=_DEFAULT_QUESTIONNAIRE_PROMPT_ID,
        pattern=r"^[A-Za-z0-9_-]+$",
        max_length=100,
    )
    classification_config_id: str = Field(
        default=_DEFAULT_CLASSIFICATION_CONFIG_ID,
    )
    classification_prompt_id: str = Field(
        default=_DEFAULT_CLASSIFICATION_PROMPT_ID,
    )


class PipelineRunResponse(BaseModel):
    questionnaire: dict
    classification: dict


def _map_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, (KeyError, PromptTemplateError)):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, LLMParseError):
        return HTTPException(
            status_code=502,
            detail=f"LLM returned unparseable output: {exc}",
        )
    raise exc


@router.post(
    "/systems/{system_id}/classification-llm-run",
    response_model=ClassificationRunResponse,
    dependencies=[Depends(require_permission("systems:write"))],
)
async def trigger_classification_llm_run(
    system_id: str,
    body: ClassificationRunRequest,
) -> ClassificationRunResponse:
    """Run Step 2 (risk & role classification) against a completed questionnaire result.

    Pass the ``run_key`` returned by ``POST /questionnaire-llm-run`` as
    ``questionnaire_run_key``. Returns the MinIO key, a 24-hour presigned URL,
    and the full classification result.

    - 404 if the questionnaire result object or config/prompt file is not found.
    - 502 if the LLM returns unparseable JSON after the auto-repair retry.
    """
    try:
        output = await run_classification(
            system_id=system_id,
            questionnaire_run_key=body.questionnaire_run_key,
            classification_config_id=body.classification_config_id,
            prompt_id=body.prompt_id,
        )
    except (KeyError, PromptTemplateError, LLMParseError) as exc:
        raise _map_errors(exc) from exc

    return ClassificationRunResponse(**output)


@router.post(
    "/systems/{system_id}/ai-assisted-assessment-prefill-run",
    response_model=PipelineRunResponse,
    dependencies=[Depends(require_permission("systems:write"))],
)
async def trigger_ai_assisted_assessment_prefill_run(
    system_id: str,
    body: PipelineRunRequest,
    request: Request,
) -> PipelineRunResponse:
    """Run the full AI-assisted assessment prefill pipeline: Step 1 (questionnaire) → Step 2 (classification).

    Returns both step outputs under ``questionnaire`` and ``classification`` keys.
    Issue #371 will add a ``hierarchy`` key for Step 3 without breaking this contract.

    - 404 if the system, questionnaire/prompt/config file is not found.
    - 502 if either step returns unparseable LLM output after the auto-repair retry.
    """
    username = request.headers.get("x-forwarded-preferred-username", "anonymous")

    try:
        questionnaire_output = await run_pipeline(
            system_id=system_id,
            questionnaire_id=body.questionnaire_id,
            prompt_id=body.questionnaire_prompt_id,
            username=username,
        )
    except (KeyError, PromptTemplateError, LLMParseError) as exc:
        raise _map_errors(exc) from exc

    try:
        classification_output = await run_classification(
            system_id=system_id,
            questionnaire_run_key=questionnaire_output["run_key"],
            classification_config_id=body.classification_config_id,
            prompt_id=body.classification_prompt_id,
        )
    except (KeyError, PromptTemplateError, LLMParseError) as exc:
        raise _map_errors(exc) from exc

    return PipelineRunResponse(
        questionnaire=questionnaire_output,
        classification=classification_output,
    )
