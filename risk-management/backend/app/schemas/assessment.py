from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AssessmentIdentifyRequest(BaseModel):
    system_description: str
    metadata: dict[str, Any]
    use_llm: bool = False
    use_stub: bool = True


class AssessmentIdentifyResponse(BaseModel):
    backend_used: str
    risks: list[dict[str, Any]]
    raw_output: dict = {}


class AssessmentEvaluateRequest(BaseModel):
    system_description: str
    metadata: dict[str, Any]
    risks: list[dict[str, Any]]
    use_llm: bool = False


class AssessmentEvaluateResponse(BaseModel):
    risks: list[dict[str, Any]]
    risk_classification: dict[str, Any]
    vulnerable_group_assessments: list[dict[str, Any]]
    related_incidents: list[dict[str, Any]]


class AssessmentMitigateRequest(BaseModel):
    metadata: dict[str, Any]
    risks: list[dict[str, Any]]
    use_llm: bool = False


class AssessmentMitigateResponse(BaseModel):
    mitigations: list[dict[str, Any]]
    residual_risk_argument: dict[str, Any]


class AssessmentExportRequest(BaseModel):
    register: dict[str, Any]


class AssessmentExportResponse(BaseModel):
    json_output: str
    markdown_output: str
