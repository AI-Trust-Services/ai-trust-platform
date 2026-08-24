from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field


class IncidentIngestRequest(BaseModel):
    register_id: str
    incident_id: str = Field(default_factory=lambda: f"INC-{uuid.uuid4().hex[:8].upper()}")
    title: str
    description: str
    severity: str = "medium"  # critical, high, medium, low
    source: str = "webhook"
    affected_risk_ids: list[str] = Field(default_factory=list)
    reporter: str = ""
    corrective_action: str = ""
    extra: dict[str, Any] = Field(default_factory=dict)


class IncidentIngestResponse(BaseModel):
    message: str
    register_id: str
    incident_id: str


class IncidentListResponse(BaseModel):
    register_id: str
    incidents: list[dict[str, Any]]
