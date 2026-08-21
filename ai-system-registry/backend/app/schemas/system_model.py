"""Pydantic v2 schemas for AI System ↔ Model Card links."""
from __future__ import annotations

from pydantic import BaseModel

from ai_trust_persistence.models.model_card import ModelCard
from app.schemas.model_card import ModelCardResponse


class SystemModelLinkBody(BaseModel):
    model_card_id: str
    role: str | None = None


class SystemModelResponse(ModelCardResponse):
    role: str | None

    @classmethod
    def from_card(cls, card: ModelCard, role: str | None) -> SystemModelResponse:
        return cls(role=role, **ModelCardResponse.model_validate(card).model_dump())
