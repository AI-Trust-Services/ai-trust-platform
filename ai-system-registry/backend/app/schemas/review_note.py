"""Pydantic schemas for review notes."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ReviewNoteCreate(BaseModel):
    """Schema for creating a review note."""

    page_path: str = Field(..., min_length=1, max_length=500)
    content: str = Field(..., min_length=1)


class ReviewNoteUpdate(BaseModel):
    """Schema for updating a review note."""

    content: str | None = Field(default=None, min_length=1)
    status: Literal["pending", "confirmed", "rejected", "done"] | None = None


class ReviewNoteResponse(BaseModel):
    """Schema for review note responses."""

    id: str
    page_path: str
    content: str
    status: Literal["pending", "confirmed", "rejected", "done"]
    author_username: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
