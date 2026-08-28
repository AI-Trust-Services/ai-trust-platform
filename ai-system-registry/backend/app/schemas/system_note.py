"""Pydantic schemas for system notes."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SystemNoteCreate(BaseModel):
    """Request body for creating a system note."""
    content: str


class SystemNoteUpdate(BaseModel):
    """Request body for updating a system note."""
    content: str | None = None


class SystemNoteResponse(BaseModel):
    """Response schema for a system note."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    ai_system_id: str
    content: str
    author_username: str
    created_at: datetime
    updated_at: datetime
