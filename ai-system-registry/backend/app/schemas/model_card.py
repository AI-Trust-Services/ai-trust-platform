"""Pydantic v2 schemas for Model Card."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ModelCardCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    provider: str = Field(..., min_length=1, max_length=100)
    version: str = Field(default="", max_length=50)
    model_type: Literal["llm", "embedding", "multimodal", "classifier"] = "llm"
    description: str = Field(default="")
    open_weights: bool = False
    inference_url: str = Field(default="", max_length=500)


class ModelCardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    provider: str | None = Field(default=None, min_length=1, max_length=100)
    version: str | None = Field(default=None, max_length=50)
    model_type: Literal["llm", "embedding", "multimodal", "classifier"] | None = None
    description: str | None = None
    open_weights: bool | None = None
    inference_url: str | None = Field(default=None, max_length=500)


class ModelCardResponse(BaseModel):
    id: str
    name: str
    provider: str
    version: str
    model_type: str
    description: str
    open_weights: bool
    inference_url: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
