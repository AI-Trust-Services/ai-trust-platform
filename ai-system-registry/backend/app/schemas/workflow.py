"""Pydantic schemas for workflow endpoints."""
from __future__ import annotations

from datetime import datetime

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


class WorkflowRejectRequest(BaseModel):
    note: str
    assignee_username: str
