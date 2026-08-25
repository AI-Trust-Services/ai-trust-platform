from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class AnnexIIICategory(str, Enum):
    BIOMETRIC = "biometric"
    CRITICAL_INFRASTRUCTURE = "critical_infrastructure"
    EDUCATION = "education"
    EMPLOYMENT = "employment"
    ESSENTIAL_SERVICES = "essential_services"
    LAW_ENFORCEMENT = "law_enforcement"
    MIGRATION = "migration"
    JUSTICE = "justice"
    OTHER = "other"


class RiskSource(str, Enum):
    RULE_BASED = "rule_based"
    STUB = "stub"
    LLM_ASSISTED = "llm_assisted"
    RISK_ATLAS_NEXUS = "risk_atlas_nexus"
    QUESTIONNAIRE = "questionnaire"
    MANUAL = "manual"


class SeverityLevel(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class LikelihoodLevel(str, Enum):
    VERY_LIKELY = "very_likely"
    LIKELY = "likely"
    POSSIBLE = "possible"
    UNLIKELY = "unlikely"


class MitigationHierarchyLevel(str, Enum):
    ELIMINATE = "eliminate"
    REDUCE = "reduce"
    MITIGATE = "mitigate"
    INFORM = "inform"


class LLMProvider(str, Enum):
    OLLAMA = "ollama"
    OPENAI_COMPATIBLE = "openai_compatible"
    NONE = "none"


# Severity × Likelihood composite scoring matrix
_SEVERITY_SCORE = {
    SeverityLevel.CRITICAL: 4,
    SeverityLevel.HIGH: 3,
    SeverityLevel.MEDIUM: 2,
    SeverityLevel.LOW: 1,
}

_LIKELIHOOD_SCORE = {
    LikelihoodLevel.VERY_LIKELY: 4,
    LikelihoodLevel.LIKELY: 3,
    LikelihoodLevel.POSSIBLE: 2,
    LikelihoodLevel.UNLIKELY: 1,
}


def composite_severity(severity: SeverityLevel, likelihood: LikelihoodLevel) -> SeverityLevel:
    score = _SEVERITY_SCORE[severity] * _LIKELIHOOD_SCORE[likelihood]
    if score >= 12:
        return SeverityLevel.CRITICAL
    elif score >= 6:
        return SeverityLevel.HIGH
    elif score >= 3:
        return SeverityLevel.MEDIUM
    else:
        return SeverityLevel.LOW


class AISystemMetadata(BaseModel):
    name: str
    version: str = "1.0"
    description: str = ""
    annex_iii_category: AnnexIIICategory = AnnexIIICategory.OTHER
    annex_iii_point: str = ""
    developer_org: str = ""
    intended_purpose: str = ""
    intended_users: list[str] = Field(default_factory=list)
    deployment_context: str = ""
    data_inputs: list[str] = Field(default_factory=list)
    ai_techniques: list[str] = Field(default_factory=list)


class TaxonomyMapping(BaseModel):
    taxonomy: str
    category: str
    identifier: Optional[str] = None


class MisuseScenario(BaseModel):
    id: str = Field(default_factory=lambda: f"MIS-{uuid4().hex[:6].upper()}")
    description: str
    actor: str
    vulnerable_group: Optional[str] = None
    likelihood: LikelihoodLevel = LikelihoodLevel.POSSIBLE
    consequence: str


class Risk(BaseModel):
    id: str
    title: str
    description: str
    category: str
    source: RiskSource = RiskSource.RULE_BASED
    taxonomy_mappings: list[TaxonomyMapping] = Field(default_factory=list)
    default_severity: SeverityLevel = SeverityLevel.MEDIUM
    severity: SeverityLevel = SeverityLevel.MEDIUM
    likelihood: LikelihoodLevel = LikelihoodLevel.POSSIBLE
    misuse_scenarios: list[MisuseScenario] = Field(default_factory=list)
    affects_vulnerable_groups: bool = False
    vulnerable_groups: list[str] = Field(default_factory=list)
    article_9_step: str = "9(2)(a)"
    suggested_mitigation_id: str = ""
    questionnaire_question_id: str = ""
    confirmed: bool = False
    dismissed: bool = False
    review_notes: str = ""


class MitigationMeasure(BaseModel):
    id: str
    title: str
    description: str
    hierarchy_level: MitigationHierarchyLevel
    applicable_risk_categories: list[str] = Field(default_factory=list)
    implementation_guidance: str = ""
    source: str = ""
    assigned_to_risk_ids: list[str] = Field(default_factory=list)
    user_override: bool = False
    override_notes: str = ""


class RiskClassification(BaseModel):
    """Result of automatic AI Act risk level classification (EuConform/GetRegula pattern)."""
    risk_level: str  # "unacceptable", "high", "limited", "minimal"
    annex_iii_match: bool = False
    annex_iii_point: str = ""
    reasoning: str = ""
    confidence: str = "medium"  # "high", "medium", "low"


class VulnerableGroupAssessment(BaseModel):
    """Dedicated Art. 9(9) checkpoint — special attention for vulnerable groups."""
    group: str
    identified_by: str  # "rule_based", "llm", "manual"
    risk_ids: list[str] = Field(default_factory=list)
    specific_safeguards: list[str] = Field(default_factory=list)
    reviewed: bool = False
    reviewer_notes: str = ""


class RelatedIncident(BaseModel):
    """A real AI incident from the AI Incident Database relevant to this system."""
    incident_id: str
    title: str
    description: str
    url: str = ""
    relevance_reason: str = ""
    source: str = "AI Incident Database"


class ResidualRiskArgument(BaseModel):
    """
    Structured residual-risk acceptability argument (Art. 9(5)).
    Inspired by GSN (Goal Structuring Notation) assurance cases from safety-critical systems.
    """
    claim: str  # "Residual risk for [system] is acceptable because..."
    evidence: list[str] = Field(default_factory=list)  # test results, mitigations applied, etc.
    assumptions: list[str] = Field(default_factory=list)
    open_issues: list[str] = Field(default_factory=list)
    expert_sign_off: bool = False
    sign_off_notes: str = ""
    acceptable: Optional[bool] = None


class AuditLogEntry(BaseModel):
    """Single entry in the assessment audit trail (Art. 12 / airblackbox pattern)."""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    action: str  # e.g. "risk_confirmed", "mitigation_added", "review_completed"
    actor: str = "user"
    entity_id: str = ""  # risk ID, mitigation ID, etc.
    details: dict = Field(default_factory=dict)


class RiskRegister(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    system: AISystemMetadata
    risks: list[Risk] = Field(default_factory=list)
    mitigations: list[MitigationMeasure] = Field(default_factory=list)
    generation_config: dict = Field(default_factory=dict)
    review_complete: bool = False
    residual_risk_acceptable: Optional[bool] = None
    notes: str = ""
    # New fields from gap analysis
    risk_classification: Optional[RiskClassification] = None
    vulnerable_group_assessments: list[VulnerableGroupAssessment] = Field(default_factory=list)
    related_incidents: list[RelatedIncident] = Field(default_factory=list)
    residual_risk_argument: Optional[ResidualRiskArgument] = None
    audit_log: list[AuditLogEntry] = Field(default_factory=list)
