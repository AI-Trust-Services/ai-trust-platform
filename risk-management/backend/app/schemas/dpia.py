from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class DPIARequest(BaseModel):
    register: dict[str, Any]


class DPIAResponse(BaseModel):
    dpia_id: str
    overall_risk_level: str
    sa_consultation_required: bool
    markdown_output: str
    dpia: dict[str, Any]
