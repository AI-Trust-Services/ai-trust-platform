import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import select

from app import cognee_client
from app.database import SessionLocal
from app.ids import new_id
from app.models.feedback import Feedback
from app.schemas import FeedbackRequest, FeedbackResponse

router = APIRouter(prefix="/feedback", tags=["feedback"])


def _to_response(row: Feedback) -> FeedbackResponse:
    try:
        node_ids = json.loads(row.supporting_node_ids)
    except Exception:
        node_ids = []
    return FeedbackResponse(
        id=row.id,
        evaluation_id=row.evaluation_id,
        conclusion=row.conclusion,
        reasoning=row.reasoning,
        supporting_node_ids=node_ids,
        conditions=row.conditions,
        status=row.status,
        reviewer=row.reviewer,
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
    )


@router.post("", response_model=FeedbackResponse, status_code=201)
async def create_feedback(body: FeedbackRequest) -> FeedbackResponse:
    """Capture feedback on an evaluation (status starts as pending)."""
    row = Feedback(
        id=new_id("EFB"),
        evaluation_id=body.evaluation_id,
        conclusion=body.conclusion,
        reasoning=body.reasoning,
        supporting_node_ids=json.dumps(body.supporting_node_ids),
        conditions=body.conditions,
        status="pending",
    )
    async with SessionLocal() as session:
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return _to_response(row)


@router.get("", response_model=list[FeedbackResponse])
async def list_feedback(
    status: str | None = Query(None, description="pending | approved | rejected"),
    limit: int = Query(50, le=200),
) -> list[FeedbackResponse]:
    async with SessionLocal() as session:
        q = select(Feedback).order_by(Feedback.created_at.desc()).limit(limit)
        if status:
            q = q.where(Feedback.status == status)
        result = await session.execute(q)
        rows = result.scalars().all()
    return [_to_response(r) for r in rows]


@router.get("/{feedback_id}", response_model=FeedbackResponse)
async def get_feedback(feedback_id: str) -> FeedbackResponse:
    async with SessionLocal() as session:
        row = await session.get(Feedback, feedback_id)
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return _to_response(row)


@router.patch("/{feedback_id}/approve", response_model=FeedbackResponse)
async def approve_feedback(feedback_id: str, request: Request) -> FeedbackResponse:
    """Approve feedback and re-ingest the corrected reasoning into the graph."""
    reviewer = request.headers.get("x-forwarded-preferred-username", "").strip() or None
    async with SessionLocal() as session:
        row = await session.get(Feedback, feedback_id)
        if not row:
            raise HTTPException(status_code=404, detail="Feedback not found")
        if row.status != "pending":
            raise HTTPException(status_code=409, detail=f"Feedback is already {row.status}")
        row.status = "approved"
        row.reviewer = reviewer
        row.reviewed_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(row)

    try:
        node_ids = json.loads(row.supporting_node_ids)
    except Exception:
        node_ids = []
    text = f"Conclusion: {row.conclusion}\nReasoning: {row.reasoning}"
    if row.conditions:
        text += f"\nConditions: {row.conditions}"
    await cognee_client.ingest_feedback(row.id, text, node_ids)

    return _to_response(row)


@router.patch("/{feedback_id}/reject", response_model=FeedbackResponse)
async def reject_feedback(feedback_id: str, request: Request) -> FeedbackResponse:
    """Reject feedback without re-ingestion."""
    reviewer = request.headers.get("x-forwarded-preferred-username", "").strip() or None
    async with SessionLocal() as session:
        row = await session.get(Feedback, feedback_id)
        if not row:
            raise HTTPException(status_code=404, detail="Feedback not found")
        if row.status != "pending":
            raise HTTPException(status_code=409, detail=f"Feedback is already {row.status}")
        row.status = "rejected"
        row.reviewer = reviewer
        row.reviewed_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(row)
    return _to_response(row)
