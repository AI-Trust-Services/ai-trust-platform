"""Pydantic v2 schemas for Control."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

VALID_CONTROL_CATEGORIES = frozenset({
    "human_oversight", "documentation", "monitoring", "security", "fairness",
    "data_governance", "logging", "testing", "change_management",
    "incident_response", "general",
})
VALID_CONTROL_STATUSES = frozenset({
    "not_started", "planned", "in_implementation", "implemented",
    "under_review", "effective", "ineffective", "deactivated",
})
VALID_EFFECTIVENESS = frozenset({"high", "medium", "low"})


class ControlCreate(BaseModel):
    ai_system_id: str | None = Field(default=None, max_length=20)
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    category: str = Field(default="general")
    owner: str = Field(default="", max_length=200)
    due_date: date | None = None

    @field_validator("title")
    @classmethod
    def title_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("title must not be blank")
        return v

    @field_validator("category")
    @classmethod
    def category_valid(cls, v: str) -> str:
        if v not in VALID_CONTROL_CATEGORIES:
            raise ValueError(f"invalid control category '{v}'")
        return v


class ControlUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    status: str | None = None
    effectiveness: str | None = None
    owner: str | None = Field(default=None, max_length=200)
    due_date: date | None = None

    @field_validator("category")
    @classmethod
    def category_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_CONTROL_CATEGORIES:
            raise ValueError(f"invalid control category '{v}'")
        return v

    @field_validator("status")
    @classmethod
    def status_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_CONTROL_STATUSES:
            raise ValueError(f"invalid control status '{v}'")
        return v

    @field_validator("effectiveness")
    @classmethod
    def effectiveness_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_EFFECTIVENESS:
            raise ValueError(f"invalid effectiveness '{v}'")
        return v


class ControlResponse(BaseModel):
    id: str
    ai_system_id: str | None
    title: str
    description: str
    category: str
    status: str
    effectiveness: str
    owner: str
    due_date: date | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ControlDetailResponse(ControlResponse):
    obligation_ids: list[str] = []
    evidence_count: int = 0
