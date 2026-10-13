"""Read-only recall endpoint — graph passages without LLM answer or persistence."""

from ai_trust_logging import get_logger
from fastapi import APIRouter

from app import cognee_client
from app.schemas import EvidenceItem, RecallRequest

logger = get_logger(__name__)

router = APIRouter(prefix="/recall", tags=["recall"])


@router.post("", response_model=list[EvidenceItem])
async def recall_passages(body: RecallRequest) -> list[EvidenceItem]:
    """Return up to *k* graph passages for *question* — no answer, no DB writes."""
    logger.info(
        "recall.started",
        extra={"question_len": len(body.question), "k": body.k},
    )
    passages = await cognee_client.recall(body.question)
    items = [EvidenceItem(**p) for p in passages[: body.k]]
    logger.info(
        "recall.completed",
        extra={"passages_found": len(passages), "returned": len(items)},
    )
    return items
