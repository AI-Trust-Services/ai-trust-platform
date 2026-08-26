from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class AssessmentIdentifyRequest(BaseModel):
    system_description: str
    source_code: str = ""
    metadata: dict[str, Any]
    use_llm: bool = False
    use_stub: bool = True
    use_risk_atlas_nexus: bool = False
    use_questionnaire: bool = False
    questionnaire_answers: list[dict[str, Any]] = []


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
    instructions_for_use: str = ""


class QuestionnaireFillRequest(BaseModel):
    system_description: str
    source_code: str = ""
    metadata: dict[str, Any]


class QuestionnaireFillResponse(BaseModel):
    questions: list[dict[str, Any]]
    answers: list[dict[str, Any]]


class QuestionAnswerRequest(BaseModel):
    question_id: str
    system_description: str
    source_code: str = ""
    metadata: dict[str, Any]


class QuestionAnswerResponse(BaseModel):
    answer: dict[str, Any]  # QuestionnaireAnswer as dict
