"""Request/response schemas for POST /v1/systems/{id}/classification/resolve."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class LabelOverrides(BaseModel):
    answers: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Per-question answer overrides. Key = questionId, value = list of answer values. Triggers rule re-evaluation.",
    )
    labels: dict[str, bool] = Field(
        default_factory=dict,
        description="Per-label result overrides. Key = labelId, value = bool. Bypasses rule evaluation.",
    )
    risk_winner: str | None = Field(
        default=None,
        alias="riskWinner",
        description="Force a specific risk label as winner, bypassing hierarchy resolution.",
    )

    model_config = {"populate_by_name": True}


class ResolvedLabel(BaseModel):
    label_id: str = Field(alias="labelId")
    result: bool
    source: Literal["pipeline", "user", "skipped"]

    # Raw float from Pipeline 2 classifications[].confidence (0–100).
    # None when source="user" (override drops the pipeline value).
    confidence: float | None = Field()

    confidence_band: Literal["High", "Medium", "Low"] | None = Field(
        default=None, alias="confidenceBand"
    )
    explanation: str | None = None

    model_config = {"populate_by_name": True}


class ResolveResponse(BaseModel):
    risk: ResolvedLabel
    transparency: ResolvedLabel | None = None
    roles: list[ResolvedLabel]
