"""Pydantic schemas for workflow endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

from app.questionnaire_required import VALID_QUESTION_KEYS


class WorkflowStepResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    step: str
    actor_username: str
    assignee_username: str | None
    note: str | None
    created_at: datetime


class WorkflowSubmitRequest(BaseModel):
    assignee_username: str
    note: str | None = None


class WorkflowApproveRequest(BaseModel):
    note: str | None = None
    # Optional CO tier override applied at approve time; validated against VALID_TIERS.
    tier: str | None = None
    # Optional CO role override — corrects the provider/deployer/both assignment.
    org_role: str | None = None


class WorkflowRejectRequest(BaseModel):
    note: str
    assignee_username: str
    send_to: Literal["business", "technical"] = "business"


class WorkflowAssignRequest(BaseModel):
    # Optional so the same schema serves full_manual (which has no section assignees).
    business_assignee_username: str | None = None
    technical_assignee_username: str | None = None
    compliance_officer_username: str | None = None
    # Set alongside assignment so the assessment-creation flow can record the system's
    # intended purpose without a separate (assignee-guarded) PUT to /systems/{id}.
    intended_purpose: str | None = None
    note: str | None = None

    @field_validator(
        "business_assignee_username",
        "technical_assignee_username",
        "compliance_officer_username",
        mode="before",
    )
    @classmethod
    def blank_username_to_none(cls, v):
        """Coerce ""/whitespace → None. A falsy-but-present assignee would otherwise
        slip past the ``row.<assignee> and ...`` edit guards in systems/workflow."""
        if isinstance(v, str):
            v = v.strip()
        return v or None


class WorkflowSubmitSectionRequest(BaseModel):
    note: str | None = None


class WorkflowSubAssignRequest(BaseModel):
    """Section owner hands a section to a contributor (task handoff, Model B1)."""
    section: Literal["business", "technical"]
    sub_assignee_username: str
    note: str | None = None


class WorkflowSubReclaimRequest(BaseModel):
    """Section owner cancels an active sub-assignment and reclaims editing."""
    section: Literal["business", "technical"]
    note: str | None = None


class WorkflowRequestInfoRequest(BaseModel):
    """CO sends a system back to a specific contributor for more information."""
    contributor_username: str
    note: str


class QuestionAssignRequest(BaseModel):
    """Section owner assigns a single questionnaire question to another user."""
    section: Literal["business", "technical"]
    question_key: str
    assignee_username: str
    note: str | None = None

    @field_validator("question_key")
    @classmethod
    def must_be_valid_key(cls, v: str) -> str:
        if v not in VALID_QUESTION_KEYS:
            raise ValueError(f"Unknown question_key '{v}'")
        return v


class QuestionUnassignRequest(BaseModel):
    """Section owner removes a per-question assignment."""
    section: Literal["business", "technical"]
    question_key: str

    @field_validator("question_key")
    @classmethod
    def must_be_valid_key(cls, v: str) -> str:
        if v not in VALID_QUESTION_KEYS:
            raise ValueError(f"Unknown question_key '{v}'")
        return v


class QuestionAnswerRequest(BaseModel):
    """Assignee marks their assigned question as answered."""
    section: Literal["business", "technical"]
    question_key: str

    @field_validator("question_key")
    @classmethod
    def must_be_valid_key(cls, v: str) -> str:
        if v not in VALID_QUESTION_KEYS:
            raise ValueError(f"Unknown question_key '{v}'")
        return v


class QuestionAssignmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    section: str
    question_key: str
    assignee_username: str
    assigned_by_username: str
    assigned_at: datetime
    answered_at: datetime | None
