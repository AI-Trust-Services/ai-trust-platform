"""Pydantic v2 schemas for AI System ↔ Model Card links."""
from __future__ import annotations

from pydantic import BaseModel, Field

from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.model_card import ModelCard
from app.schemas.model_card import ModelCardResponse


class SystemModelLinkBody(BaseModel):
    model_card_id: str = Field(..., min_length=1, max_length=20)
    role: str | None = Field(default=None, max_length=100)


class SystemModelResponse(ModelCardResponse):
    role: str | None

    @classmethod
    def from_card(cls, card: ModelCard, role: str | None) -> SystemModelResponse:
        return cls(role=role, **ModelCardResponse.model_validate(card).model_dump())


class ModelSystemResponse(BaseModel):
    id: str
    name: str
    tier: str
    lifecycle: str
    compliance: float
    role: str | None

    model_config = {"from_attributes": True}

    @classmethod
    def from_system(cls, system: AISystem, role: str | None) -> ModelSystemResponse:
        return cls(role=role, id=system.id, name=system.name, tier=system.tier, lifecycle=system.lifecycle, compliance=system.compliance)
