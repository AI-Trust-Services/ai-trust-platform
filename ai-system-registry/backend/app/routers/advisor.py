"""POST /v1/systems/{system_id}/advisor/ask — Compliance Advisor chatbot.

A stateless chat turn backed by the PydanticAI advisor agent (see
``app/advisor/agent.py``). The frontend holds the transcript and resends it
each turn. The agent grounds every answer in two tools (system-document RAG +
EU AI Act knowledge base) and returns a structured ``{answer, sources}``.

Gated ``systems:read`` — the advisor is read-only drill-down, matching the
``/retrieve`` and ``/classify/evaluate`` surfaces, so a compliance officer
(``systems:read`` + ``systems:approve``) can use it too.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ai_trust_authorization.permissions import require_permission
from ai_trust_logging import correlation_id_var
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem

from app.advisor.agent import (
    AdvisorAnswer,
    AdvisorDeps,
    AdvisorGuardrailError,
    AdvisorSource,
    ask_advisor,
)

router = APIRouter(tags=["advisor"])

_MAX_MESSAGE_LEN = 4000
_MAX_TRANSCRIPT_TURNS = 20


class TranscriptTurn(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(max_length=_MAX_MESSAGE_LEN)


class AdvisorAskRequest(BaseModel):
    message: str = Field(min_length=1, max_length=_MAX_MESSAGE_LEN)
    transcript: list[TranscriptTurn] = Field(
        default_factory=list, max_length=_MAX_TRANSCRIPT_TURNS
    )


class AdvisorAskResponse(BaseModel):
    answer: str
    sources: list[AdvisorSource]
    degraded: bool


def _bearer_token(request: Request) -> str | None:
    """Forwarded OIDC token — same two-source read as libs/tenancy resolver."""
    xat = request.headers.get("x-forwarded-access-token", "").strip()
    if xat:
        return xat
    auth = request.headers.get("authorization", "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


@router.post(
    "/systems/{system_id}/advisor/ask",
    response_model=AdvisorAskResponse,
    dependencies=[Depends(require_permission("systems:read"))],
)
async def advisor_ask(
    system_id: str,
    body: AdvisorAskRequest,
    request: Request,
) -> AdvisorAskResponse:
    """Answer one advisor question, grounded in the system's docs + the EU AI Act.

    - 404 if the system is not found.
    - 502 if the agent trips a guardrail (usage limit / timeout) with no answer.
    """
    # 404-before-work: confirms the system exists (and avoids wasted LLM spend).
    async with SessionLocal() as session:
        row = (
            await session.execute(select(AISystem).where(AISystem.id == system_id))
        ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404, detail=f"AI system '{system_id}' not found"
        )

    username = request.headers.get("x-forwarded-preferred-username", "anonymous")
    deps = AdvisorDeps(
        system_id=system_id,
        username=username,
        access_token=_bearer_token(request),
        correlation_id=correlation_id_var.get("") or None,
    )

    try:
        answer, degraded = await ask_advisor(
            message=body.message,
            deps=deps,
            transcript=[t.model_dump() for t in body.transcript],
        )
    except AdvisorGuardrailError as exc:
        raise HTTPException(
            status_code=502,
            detail="The assistant could not complete this request. Please try again.",
        ) from exc

    return AdvisorAskResponse(
        answer=answer.answer, sources=answer.sources, degraded=degraded
    )


# Re-export for callers/tests that import the output model from the router.
__all__ = ["router", "AdvisorAnswer"]
