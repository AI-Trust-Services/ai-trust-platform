"""Pydantic schemas for the single-page EU AI Act assessment endpoints.

Backs the redesigned per-question assessment flow (issues #346/#314): the start
page (classification + confidence counts + decisive questions), the per-question
view (answer/confidence/source/comments/assignment), and finalize/submit. Kept
separate from ``schemas/workflow.py`` (the section-sequenced chain being retired).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, field_validator

from app.questionnaire_required import VALID_QUESTION_KEYS

CONFIDENCE_LEVELS = frozenset({"high", "medium", "low"})


def _validate_question_key(v: str) -> str:
    # Called directly (as a statement) at the top of the per-question routes with
    # the path parameter — NOT as a Pydantic field validator — so a plain
    # ValueError would propagate to the 500 handler. Raise HTTPException so an
    # unknown key is a 422 client error, matching the rest of the API contract.
    if v not in VALID_QUESTION_KEYS:
        raise HTTPException(status_code=422, detail=f"Unknown question_key '{v}'")
    return v


# ── Per-question state ─────────────────────────────────────────────────────


class QuestionStateResponse(BaseModel):
    model_config = {"from_attributes": True}

    question_key: str
    answer: str | None = None
    answer_source: str = "ai_prefilled"
    confidence: str | None = None
    # confirmed = any confirmation (owner or contributor); owner_confirmed = the
    # stronger state that the submit gate requires.
    confirmed: bool = False
    owner_confirmed: bool = False
    assignee_username: str | None = None
    comment_count: int = 0
    # Derived: this question is flagged for the owner's attention
    # (low confidence OR left unanswered by the AI).
    needs_attention: bool = False
    # Whether the requesting user may edit THIS question right now (only meaningful
    # when the assessment-level `editable` is true).
    can_edit: bool = True


class AnswerRequest(BaseModel):
    """Autosave a single question's answer value."""

    answer: str

    @field_validator("answer")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v


class ConfirmResponse(BaseModel):
    """Returned by confirm/unconfirm so the client can update the sidebar."""

    question_key: str
    confirmed: bool


# ── Comments ───────────────────────────────────────────────────────────────


class CommentCreate(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Comment body must not be empty")
        return v.strip()


class CommentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    question_key: str
    author_username: str
    body: str
    created_at: datetime


# ── Assignment ─────────────────────────────────────────────────────────────


class AssignRequest(BaseModel):
    assignee_username: str

    @field_validator("assignee_username")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("assignee_username must not be empty")
        return v


# ── Start-page / classification view model ──────────────────────────────────


class ConfidenceCounts(BaseModel):
    high: int = 0
    medium: int = 0
    low: int = 0


class DecisiveQuestion(BaseModel):
    """One answer that materially drove the current classification (#346)."""

    section: str
    question_key: str
    question_label: str
    answer: str | None = None


class SourceDocumentRef(BaseModel):
    """A source document that informed the classification (assessment-level)."""

    name: str
    page: int | None = None


class ContributorRef(BaseModel):
    """A user who may be assigned questions on this assessment (owner + the
    system's registered contributors)."""

    username: str
    display_name: str | None = None


class AssessmentStateResponse(BaseModel):
    """Full view model for the start page + left sidebar (#346) in one read."""

    system_id: str
    system_name: str
    registration_mode: str
    workflow_status: str
    # Owner-facing lifecycle label derived from the status (e.g. "locked" when the
    # assessment is pending_review/submitted, "under_review" when returned).
    status_label: str = ""
    # Assessment-level read-only gate: false when locked (submitted/pending_review),
    # approved, or the viewer may not edit at all. When false the whole app is
    # read-only; when true, per-question `can_edit` applies.
    editable: bool = True

    # Preliminary (AI-generated, not final) classification.
    tier: str
    basis: str | None = None
    org_role: str | None = None
    reasoning: str | None = None
    # EU AI Act Art.50 transparency companion to a high-risk tier — true when the
    # inferred flags imply it OR the CO explicitly issued it (co_issued_transparency).
    transparency: bool = False

    confidence_counts: ConfidenceCounts
    attention_count: int
    decisive_questions: list[DecisiveQuestion] = []
    source_documents: list[SourceDocumentRef] = []

    questions: list[QuestionStateResponse] = []
    # Candidate assignees for per-question assignment (owner + contributors).
    contributors: list[ContributorRef] = []
    # Whether a prefill pass has already run (so the client knows to show results
    # vs. trigger /open).
    prefilled: bool = False


class SubmitRequest(BaseModel):
    note: str | None = None


# ── Compliance Officer end view (#348) ───────────────────────────────────────

# Tiers the CO may issue, and the only allowed companion.
ISSUABLE_TIERS = frozenset({"minimal", "limited", "high", "prohibited"})


class IssueRequest(BaseModel):
    """CO issues the final, binding risk classification."""

    tier: str
    # The only allowed combo is high + transparency; true only valid with tier='high'.
    transparency: bool = False
    note: str | None = None
    confirmed: bool = False

    @field_validator("tier")
    @classmethod
    def _valid_tier(cls, v: str) -> str:
        if v not in ISSUABLE_TIERS:
            raise ValueError(f"Tier '{v}' is not issuable by the compliance officer")
        return v


class RejectRequest(BaseModel):
    """CO returns the assessment to the owner — note is mandatory."""

    note: str

    @field_validator("note")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A comment is required when returning the assessment")
        return v.strip()
