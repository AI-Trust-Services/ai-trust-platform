"""Pydantic v2 schemas for Framework."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class FrameworkResponse(BaseModel):
    id: str
    name: str
    version: str
    description: str
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class FrameworkUpdate(BaseModel):
    enabled: bool | None = None
