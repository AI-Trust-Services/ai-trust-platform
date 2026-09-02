"""Pydantic v2 schemas for the AI-assisted registration flow (stateless)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.schemas.ai_system import ClassificationResult, RationaleItem


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant" | "system"
    content: str


class AssistTurnRequest(BaseModel):
    """The frontend resends the full transcript + field state each turn."""
    transcript: list[ChatMessage] = []
    fields: dict[str, Any] = {}


class InferredFlag(RationaleItem):
    """Alias of RationaleItem for the assist response surface."""


class AssistTurnResponse(BaseModel):
    message: str
    extracted_fields: dict[str, Any] = {}
    next_field: str | None = None
    complete: bool = False
    degraded: bool = False  # turn-cap hit without completion → offer manual submit
    inferred_flags: list[InferredFlag] | None = None
    classification: ClassificationResult | None = None


class AssistExtractResponse(BaseModel):
    extracted_fields: dict[str, Any] = {}
    notes: str | None = None
