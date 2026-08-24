from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ai_trust_logging import get_logger
from app.schemas.assessment import (
    AssessmentIdentifyRequest,
    AssessmentIdentifyResponse,
    AssessmentEvaluateRequest,
    AssessmentEvaluateResponse,
    AssessmentMitigateRequest,
    AssessmentMitigateResponse,
    AssessmentExportRequest,
    AssessmentExportResponse,
)
from risk_management.classifier import RiskClassifier
from risk_management.config import AppConfig
from risk_management.evaluator import RiskEvaluator
from risk_management.identifier import RiskIdentifier
from risk_management.incident_lookup import IncidentLookup
from risk_management.llm_client import NullLLMClient, OllamaClient
from risk_management.mitigator import MitigationAssigner
from risk_management.models import AISystemMetadata, RiskRegister
from risk_management.reporter import Reporter
from risk_management.residual_risk import ResidualRiskAssessor
from risk_management.vulnerable_groups import VulnerableGroupChecker

router = APIRouter(tags=["assessments"])
logger = get_logger(__name__)

_BASE_DIR = Path(__file__).parent.parent.parent
_config = AppConfig(
    risk_taxonomy_path=str(_BASE_DIR / "data" / "risk_taxonomy.json"),
    mitigation_library_path=str(_BASE_DIR / "data" / "mitigation_library.json"),
    output_dir=str(_BASE_DIR / "output"),
)


def _build_llm(use_llm: bool):
    if not use_llm:
        return NullLLMClient()
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.environ.get("OLLAMA_MODEL", "llama3.2")
    return OllamaClient(base_url=base_url, model=model, temperature=0.2, timeout=120)


@router.post("/assessments/identify", response_model=AssessmentIdentifyResponse)
async def identify_risks(body: AssessmentIdentifyRequest) -> AssessmentIdentifyResponse:
    metadata = AISystemMetadata(**body.metadata)
    llm_client = _build_llm(body.use_llm)

    # Combine documentation with source code context when provided
    combined_description = body.system_description
    if body.source_code.strip():
        combined_description = (
            body.system_description
            + "\n\n--- Source Code Analysis ---\n"
            + body.source_code[:3000]
        )

    identifier = RiskIdentifier(
        taxonomy_path=_config.risk_taxonomy_path,
        llm_client=llm_client,
    )
    result = identifier.identify(
        system_description=combined_description,
        metadata=metadata,
        use_llm=body.use_llm,
        use_stub=body.use_stub,
        use_risk_atlas_nexus=body.use_risk_atlas_nexus,
    )
    logger.info("assessment.risks_identified", extra={
        "system": metadata.name,
        "count": len(result.risks),
        "backend": result.backend_used,
        "has_source_code": bool(body.source_code.strip()),
    })
    return AssessmentIdentifyResponse(
        backend_used=result.backend_used,
        risks=[r.model_dump() for r in result.risks],
        raw_output=result.raw_output,
    )


@router.post("/assessments/evaluate", response_model=AssessmentEvaluateResponse)
async def evaluate_risks(body: AssessmentEvaluateRequest) -> AssessmentEvaluateResponse:
    from risk_management.models import Risk
    metadata = AISystemMetadata(**body.metadata)
    llm_client = _build_llm(body.use_llm)
    risks = [Risk(**r) for r in body.risks]

    evaluator = RiskEvaluator()
    evaluated = evaluator.evaluate(
        risks=risks,
        metadata=metadata,
        use_llm=body.use_llm,
        llm_client=llm_client,
    )

    classifier = RiskClassifier()
    classification = classifier.classify(
        metadata=metadata,
        system_description=body.system_description,
        use_llm=body.use_llm,
        llm_client=llm_client,
    )

    vg_checker = VulnerableGroupChecker()
    confirmed = [r for r in evaluated if r.confirmed and not r.dismissed]
    vg_assessments = vg_checker.assess(
        metadata=metadata,
        risks=confirmed,
        system_description=body.system_description,
        use_llm=body.use_llm,
        llm_client=llm_client,
    )

    incident_lookup = IncidentLookup()
    incidents = incident_lookup.get_relevant_incidents(metadata=metadata)

    logger.info("assessment.risks_evaluated", extra={"system": metadata.name, "count": len(evaluated)})
    return AssessmentEvaluateResponse(
        risks=[r.model_dump() for r in evaluated],
        risk_classification=classification.model_dump(),
        vulnerable_group_assessments=[v.model_dump() for v in vg_assessments],
        related_incidents=[i.model_dump() for i in incidents],
    )


@router.post("/assessments/mitigate", response_model=AssessmentMitigateResponse)
async def assign_mitigations(body: AssessmentMitigateRequest) -> AssessmentMitigateResponse:
    from risk_management.models import Risk
    metadata = AISystemMetadata(**body.metadata)
    llm_client = _build_llm(body.use_llm)
    risks = [Risk(**r) for r in body.risks]

    assigner = MitigationAssigner(mitigation_library_path=_config.mitigation_library_path)
    mitigations = assigner.assign(risks=risks, use_llm=body.use_llm, llm_client=llm_client)

    residual_assessor = ResidualRiskAssessor()
    confirmed = [r for r in risks if r.confirmed and not r.dismissed]
    residual_arg = residual_assessor.build_argument(
        metadata=metadata,
        confirmed_risks=confirmed,
        mitigations=mitigations,
        use_llm=body.use_llm,
        llm_client=llm_client,
    )

    logger.info("assessment.mitigations_assigned", extra={
        "system": metadata.name,
        "count": len(mitigations),
    })
    return AssessmentMitigateResponse(
        mitigations=[m.model_dump() for m in mitigations],
        residual_risk_argument=residual_arg.model_dump(),
    )


@router.post("/assessments/export", response_model=AssessmentExportResponse)
async def export_register(body: AssessmentExportRequest) -> AssessmentExportResponse:
    register = RiskRegister(**body.register)
    reporter = Reporter()
    json_output = reporter.to_json(register)
    md_output = reporter.to_markdown(register)
    ifu_output = reporter.to_instructions_for_use(register)

    logger.info("assessment.exported", extra={"register_id": register.id})
    return AssessmentExportResponse(
        json_output=json_output,
        markdown_output=md_output,
        instructions_for_use=ifu_output,
    )
