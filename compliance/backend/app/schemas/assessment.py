"""Pydantic v2 schemas for Assessment."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

VALID_ASSESSMENT_TYPES = frozenset({
    "compliance", "risk", "privacy", "security", "fairness",
    "transparency", "human_oversight", "operational_readiness", "third_party",
})
VALID_ASSESSMENT_STATUSES = frozenset({
    "draft", "submitted", "under_review", "approved",
})


class AssessmentCreate(BaseModel):
    ai_system_id: str = Field(..., min_length=1, max_length=20)
    framework_id: str = Field(..., min_length=1, max_length=30)
    title: str = Field(..., min_length=1, max_length=200)
    type: str = Field(default="compliance")
    notes: str = Field(default="")

    @field_validator("title")
    @classmethod
    def title_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("title must not be blank")
        return v

    @field_validator("type")
    @classmethod
    def type_valid(cls, v: str) -> str:
        if v not in VALID_ASSESSMENT_TYPES:
            raise ValueError(f"invalid assessment type '{v}'")
        return v


class AssessmentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    type: str | None = None
    notes: str | None = None

    @field_validator("title")
    @classmethod
    def title_not_whitespace(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("title must not be blank")
        return v

    @field_validator("type")
    @classmethod
    def type_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_ASSESSMENT_TYPES:
            raise ValueError(f"invalid assessment type '{v}'")
        return v


class AssessmentResponse(BaseModel):
    id: str
    ai_system_id: str
    framework_id: str
    title: str
    type: str
    status: str
    score: float | None
    notes: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AssessmentDetailResponse(AssessmentResponse):
    obligation_count: int = 0
    fulfilled_count: int = 0
