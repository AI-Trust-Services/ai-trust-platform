"""EU AI Act RAG — compliance officer chat endpoint.

Gated on assessments:approve (held exclusively by ai_compliance_officer among
default roles; permission-based so custom roles can also have it).

Returns 503 when no index exists yet (rag-sync CronJob hasn't run) or when
LLM_PROVIDER=stub (CI/offline deployments). All other errors surface as 500.
"""

from __future__ import annotations

import asyncio

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import ASSESSMENTS_APPROVE
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/rag", tags=["rag"])


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    answer: str
    articles: list[str]


@router.post(
    "/ask",
    response_model=AskResponse,
    dependencies=[Depends(require_permission(ASSESSMENTS_APPROVE))],
)
async def ask(body: AskRequest) -> AskResponse:
    """Answer a question about the EU AI Act using the prebuilt RAG index."""
    try:
        from app.rag import query  # lazy — avoids import errors when RAG_DATA_DIR unset

        answer, articles = await asyncio.to_thread(query.ask, body.question)
        return AskResponse(answer=answer, articles=articles)
    except RuntimeError as e:
        # No index yet (rag-sync hasn't run) or index corrupted.
        raise HTTPException(status_code=503, detail=str(e)) from e
    except NotImplementedError as e:
        # LLM_PROVIDER=stub — RAG not available in this deployment.
        raise HTTPException(status_code=503, detail=str(e)) from e
