"""POST /v1/classify/evaluate — side-effect-free classification for the AI Test Bed.

Accepts raw questionnaire answers, optional retrieved context, and an optional
prompt override; runs the AI-mode classification pipeline (LLM flag inference +
deterministic classifier) and returns the result. No DB reads or writes — safe
to call from the document-indexing orchestrator without touching workflow state.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ai_trust_authorization.permissions import require_permission
from app.classifier import classify_from_questionnaire_answers
from app.llm import LLMParseError
from app.schemas import EvaluateRequest, EvaluateResponse

router = APIRouter(tags=["classify"])


@router.post(
    "/classify/evaluate",
    response_model=EvaluateResponse,
    dependencies=[Depends(require_permission("systems:read"))],
)
async def evaluate(req: EvaluateRequest) -> EvaluateResponse:
    """Run AI-mode classification without persisting anything.

    Returns tier, basis, obligations, confidence, and the full rationale
    (flags, reasoning, missing_info, org_role). A 502 is returned if the LLM
    produces unparseable output.
    """
    try:
        classification, rationale = await classify_from_questionnaire_answers(
            business_answers=dict(req.answers.business),
            technical_answers=dict(req.answers.technical),
            injected_context=req.injected_context,
            prompt_override=req.prompt_override,
            model=req.model,
        )
    except LLMParseError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return EvaluateResponse(
        tier=classification.tier,
        basis=classification.basis,
        obligations=classification.obligations,
        confidence=rationale.get("confidence"),
        rationale=rationale,
    )
