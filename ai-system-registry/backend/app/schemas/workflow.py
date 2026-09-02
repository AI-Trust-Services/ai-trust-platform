"""Pydantic schemas for workflow endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


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
    compliance_officer_username: str
    note: str | None = None


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


class QuestionUnassignRequest(BaseModel):
    """Section owner removes a per-question assignment."""
    section: Literal["business", "technical"]
    question_key: str


class QuestionAnswerRequest(BaseModel):
    """Assignee marks their assigned question as answered."""
    section: Literal["business", "technical"]
    question_key: str


class QuestionAssignmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    section: str
    question_key: str
    assignee_username: str
    assigned_by_username: str
    assigned_at: datetime
    answered_at: datetime | None
