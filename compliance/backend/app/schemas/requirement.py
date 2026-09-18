"""Pydantic v2 schemas for Requirement."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

VALID_REQUIREMENT_CATEGORIES = frozenset({
    "human_oversight", "documentation", "monitoring", "security", "fairness",
    "data_governance", "logging", "testing", "change_management",
    "incident_response", "general",
})
VALID_REQUIREMENT_STATUSES = frozenset({
    "open", "planned", "under_review", "fulfilled", "ineffective", "deactivated",
})
VALID_EFFECTIVENESS = frozenset({"high", "medium", "low"})


class RequirementCreate(BaseModel):
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
        if v not in VALID_REQUIREMENT_CATEGORIES:
            raise ValueError(f"invalid requirement category '{v}'")
        return v


class RequirementUpdate(BaseModel):
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
        if v is not None and v not in VALID_REQUIREMENT_CATEGORIES:
            raise ValueError(f"invalid requirement category '{v}'")
        return v

    @field_validator("status")
    @classmethod
    def status_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_REQUIREMENT_STATUSES:
            raise ValueError(f"invalid requirement status '{v}'")
        return v

    @field_validator("effectiveness")
    @classmethod
    def effectiveness_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_EFFECTIVENESS:
            raise ValueError(f"invalid effectiveness '{v}'")
        return v


class RequirementResponse(BaseModel):
    id: str
    ai_system_id: str | None
    requirement_ref: str | None
    article_ref: str | None = None
    title: str
    description: str
    status: str
    effectiveness: str
    owner: str
    due_date: date | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RequirementDetailResponse(RequirementResponse):
    obligation_ids: list[str] = []
    evidence_count: int = 0


class GenerateRequirementsResponse(BaseModel):
    created: list[RequirementResponse]
    message: str
