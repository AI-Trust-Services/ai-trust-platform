import json

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app import cognee_client
from app.database import SessionLocal
from app.ids import new_id
from app.models.evaluation import Evaluation
from app.schemas import EvaluateRequest, EvaluationResponse, EvidenceItem

router = APIRouter(prefix="/evaluate", tags=["evaluate"])


def _parse_evidence(raw: str | None) -> list[EvidenceItem]:
    if not raw:
        return []
    try:
        return [EvidenceItem(**item) for item in json.loads(raw)]
    except Exception:
        return []


def _to_response(row: Evaluation) -> EvaluationResponse:
    return EvaluationResponse(
        id=row.id,
        question=row.question,
        answer=row.answer,
        source_evidence=_parse_evidence(row.source_evidence),
        knowledge_gap=row.knowledge_gap,
        created_at=row.created_at,
    )


@router.post("", response_model=EvaluationResponse, status_code=201)
async def create_evaluation(body: EvaluateRequest) -> EvaluationResponse:
    """Run grounded Q&A: recall relevant passages, generate an answer, save and return."""
    passages = await cognee_client.recall(body.question)
    knowledge_gap = len(passages) == 0

    answer = await cognee_client.answer_question(body.question, passages)

    row = Evaluation(
        id=new_id("EVL"),
        question=body.question,
        answer=answer,
        source_evidence=json.dumps([
            {"text": p["text"], "node_id": p["node_id"], "score": p.get("score")}
            for p in passages[:5]
        ]),
        knowledge_gap=knowledge_gap,
    )
    async with SessionLocal() as session:
        session.add(row)
        await session.commit()
        await session.refresh(row)

    return _to_response(row)


@router.get("", response_model=list[EvaluationResponse])
async def list_evaluations(limit: int = Query(50, le=200)) -> list[EvaluationResponse]:
    """List past evaluations, newest first."""
    async with SessionLocal() as session:
        result = await session.execute(
            select(Evaluation).order_by(Evaluation.created_at.desc()).limit(limit)
        )
        rows = result.scalars().all()
    return [_to_response(r) for r in rows]


@router.get("/{evaluation_id}", response_model=EvaluationResponse)
async def get_evaluation(evaluation_id: str) -> EvaluationResponse:
    async with SessionLocal() as session:
        row = await session.get(Evaluation, evaluation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return _to_response(row)
