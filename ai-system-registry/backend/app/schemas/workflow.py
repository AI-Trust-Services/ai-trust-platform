"""Pydantic schemas for the remaining workflow endpoints.

Only the step-history response and the assignment request survive the single-page
assessment redesign; the section-fill / CO-decision / per-question schemas were
removed with their endpoints.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator


class WorkflowStepResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    step: str
    actor_username: str
    assignee_username: str | None
    note: str | None
    created_at: datetime


class WorkflowAssignRequest(BaseModel):
    # Optional so the same schema serves callers that set only a subset.
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
        """Coerce ""/whitespace → None so a falsy-but-present assignee doesn't slip
        past the ``row.<assignee> and ...`` edit guards in systems.py."""
        if isinstance(v, str):
            v = v.strip()
        return v or None
