"""Pydantic v2 schemas for Obligation."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

VALID_OBLIGATION_STATUSES = frozenset({
    "applicable", "in_progress", "fulfilled", "not_applicable", "overdue",
})


class ObligationCreate(BaseModel):
    assessment_id: str = Field(..., min_length=1, max_length=30)
    title: str = Field(..., min_length=1, max_length=300)
    article_ref: str = Field(default="", max_length=50)
    description: str = Field(default="")
    due_date: date | None = None
    owner: str = Field(default="", max_length=200)

    @field_validator("title")
    @classmethod
    def title_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("title must not be blank")
        return v


class ObligationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    article_ref: str | None = Field(default=None, max_length=50)
    description: str | None = None
    status: str | None = None
    due_date: date | None = None
    owner: str | None = Field(default=None, max_length=200)

    @field_validator("status")
    @classmethod
    def status_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_OBLIGATION_STATUSES:
            raise ValueError(f"invalid obligation status '{v}'")
        return v


class ObligationResponse(BaseModel):
    id: str
    assessment_id: str
    ai_system_id: str
    framework_id: str
    title: str
    article_ref: str
    description: str
    status: str
    due_date: date | None
    owner: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ObligationDetailResponse(ObligationResponse):
    control_ids: list[str] = []


class GenerateObligationsResponse(BaseModel):
    created: list[ObligationResponse]
    message: str
