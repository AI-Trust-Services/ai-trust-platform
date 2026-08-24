from __future__ import annotations

from fastapi import APIRouter

from ai_trust_logging import get_logger
from app.schemas.dpia import DPIARequest, DPIAResponse
from risk_management.dpia import DPIAAssessor
from risk_management.models import AISystemMetadata, Risk, RiskRegister, VulnerableGroupAssessment

router = APIRouter(tags=["dpia"])
logger = get_logger(__name__)


@router.post("/dpia", response_model=DPIAResponse)
async def generate_dpia(body: DPIARequest) -> DPIAResponse:
    """
    Generate a GDPR Article 35 Data Protection Impact Assessment (DPIA)
    from an existing risk register.
    """
    register = RiskRegister(**body.register)
    confirmed_risks = [r for r in register.risks if r.confirmed and not r.dismissed]
    vg_assessments = register.vulnerable_group_assessments

    assessor = DPIAAssessor()
    report = assessor.assess(
        metadata=register.system,
        confirmed_risks=confirmed_risks,
        vg_assessments=vg_assessments,
        linked_register_id=register.id,
    )
    md_output = assessor.to_markdown(report)

    logger.info(
        "dpia.generated",
        extra={
            "dpia_id": report.id,
            "register_id": register.id,
            "overall_risk": report.overall_risk_level,
            "sa_required": report.supervisory_authority_consultation_required,
        },
    )

    return DPIAResponse(
        dpia_id=report.id,
        overall_risk_level=report.overall_risk_level,
        sa_consultation_required=report.supervisory_authority_consultation_required,
        markdown_output=md_output,
        dpia=report.model_dump(),
    )
