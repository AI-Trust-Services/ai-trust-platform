"""POST /v1/systems/{system_id}/questionnaire-llm-run — AI-powered questionnaire answer pipeline.

Triggers the questionnaire answer pipeline for a given AI system. The pipeline
reads registration data + optional RAG documents, calls the LLM using the
configured prompt and questionnaire, and stores the result as a versioned JSON
file in MinIO.

Defaults:
  questionnaire_id: "ai-questionnaire"  → context/prompts/ai-questionnaire.json
  prompt_id:        "questionnaire_answer" → context/prompts/questionnaire_answer.md
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ai_trust_authorization.permissions import require_permission
from app.llm.parsing import LLMParseError
from app.llm.templates import PromptTemplateError
from app.questionnaire_pipeline import run_pipeline

router = APIRouter(tags=["assessment"])


class QuestionnaireRunRequest(BaseModel):
    questionnaire_id: str = Field(
        default="ai-questionnaire",
        pattern=r"^[A-Za-z0-9_-]+$",
        max_length=100,
        description="ID of the questionnaire file in context/prompts/<id>.json",
    )
    prompt_id: str = Field(
        default="questionnaire_answer",
        pattern=r"^[A-Za-z0-9_-]+$",
        max_length=100,
        description="ID of the system prompt file in context/prompts/<id>.md",
    )


class QuestionnaireRunResponse(BaseModel):
    run_key: str
    presigned_url: str
    result: dict


@router.post(
    "/systems/{system_id}/questionnaire-llm-run",
    response_model=QuestionnaireRunResponse,
    dependencies=[Depends(require_permission("systems:write"))],
)
async def trigger_questionnaire_llm_run(
    system_id: str,
    body: QuestionnaireRunRequest,
    request: Request,
) -> QuestionnaireRunResponse:
    """Trigger the AI-powered questionnaire answer pipeline for an AI system (Step 1).

    Returns the MinIO key, a 24-hour presigned download URL, and the full
    parsed LLM result ``{"results": [...]}``.

    - 404 if the system, questionnaire file, or prompt file is not found.
    - 502 if the LLM returns unparseable JSON after the auto-repair retry.
    """
    username = request.headers.get("x-forwarded-preferred-username", "anonymous")

    try:
        output = await run_pipeline(
            system_id=system_id,
            questionnaire_id=body.questionnaire_id,
            prompt_id=body.prompt_id,
            username=username,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PromptTemplateError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMParseError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"LLM returned unparseable output: {exc}",
        ) from exc

    return QuestionnaireRunResponse(**output)
