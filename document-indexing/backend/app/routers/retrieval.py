from __future__ import annotations

from fastapi import APIRouter, Depends

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ
from ai_trust_persistence import SessionLocal

from app import retrieval
from app.schemas import RetrievedPassage, RetrieveRequest

router = APIRouter(tags=["retrieval"])


@router.post(
    "/retrieve",
    response_model=list[RetrievedPassage],
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def retrieve(req: RetrieveRequest) -> list[RetrievedPassage]:
    """Shared retrieval interface: AI-system ID + query → ranked passages with source
    references. Retrieved content is source material, not a verified fact or a
    compliance decision."""
    async with SessionLocal() as session:
        results = await retrieval.retrieve(
            session, req.ai_system_id, req.query, req.k, req.mode, req.rrf_k
        )
    return [RetrievedPassage(**r) for r in results]
