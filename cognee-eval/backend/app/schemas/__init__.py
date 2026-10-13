from datetime import datetime

from pydantic import BaseModel, Field

# ── Recall ────────────────────────────────────────────────────────────────────


class RecallRequest(BaseModel):
    question: str = Field(min_length=1)
    k: int = Field(default=5, ge=1, le=50)


# ── Evaluate ─────────────────────────────────────────────────────────────────


class EvaluateRequest(BaseModel):
    question: str


class EvidenceItem(BaseModel):
    text: str
    node_id: str
    score: float | None = None


class EvaluationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    question: str
    answer: str | None
    source_evidence: list[EvidenceItem]
    knowledge_gap: bool
    created_at: datetime


# ── Feedback ──────────────────────────────────────────────────────────────────


class FeedbackRequest(BaseModel):
    evaluation_id: str
    conclusion: str
    reasoning: str
    supporting_node_ids: list[str] = []
    conditions: str | None = None


class FeedbackResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    evaluation_id: str
    conclusion: str
    reasoning: str
    supporting_node_ids: list[str]
    conditions: str | None
    status: str
    reviewer: str | None
    created_at: datetime
    reviewed_at: datetime | None
