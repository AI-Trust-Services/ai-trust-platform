from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class MisuseScenarioIn(BaseModel):
    actor: str
    description: str
    likelihood: str = "possible"
    consequence: str = ""
    vulnerable_group: Optional[str] = None


class MisuseScenarioOut(MisuseScenarioIn):
    id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MitigationMeasureIn(BaseModel):
    title: str
    description: str = ""
    hierarchy_level: str  # "eliminate" | "reduce" | "mitigate" | "inform"
    implementation_guidance: str = ""
    status: str = "planned"
    assigned_to: Optional[str] = None
    due_date: Optional[datetime] = None
    override_notes: str = ""


class MitigationMeasureOut(MitigationMeasureIn):
    id: str
    risk_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RiskEntryIn(BaseModel):
    title: str
    description: str = ""
    category: str = ""
    article_9_step: str = "9(2)(a)"
    severity: str = "medium"
    likelihood: str = "possible"
    status: str = "identified"
    review_notes: str = ""
    affects_vulnerable_groups: bool = False
    vulnerable_groups: str = ""  # JSON list
    closure_justification: str = ""
    source: str = "manual"
    taxonomy_mappings: str = ""  # JSON list
    # VerifyWise-equivalent fields
    risk_owner: Optional[str] = None
    ai_lifecycle_phase: Optional[str] = None
    impact: str = ""
    risk_level_autocalculated: Optional[str] = None
    residual_likelihood: Optional[str] = None
    residual_severity: Optional[str] = None
    final_risk_level: Optional[str] = None
    residual_status: str = "none"  # "none" | "acceptable" | "unacceptable"
    date_of_assessment: Optional[str] = None  # ISO date string
    # Issue #187: responsible role and deadline
    responsible_role: Optional[str] = None
    deadline: Optional[datetime] = None
    engineer_email: Optional[str] = None
    officer_email: Optional[str] = None
    misuse_scenarios: list[MisuseScenarioIn] = []
    mitigations: list[MitigationMeasureIn] = []
    library_risk_id: Optional[str] = None


class RiskEntryOut(BaseModel):
    id: str
    register_id: str
    title: str
    description: str
    category: str
    article_9_step: str
    severity: str
    likelihood: str
    status: str
    review_notes: str
    affects_vulnerable_groups: bool
    vulnerable_groups: str
    closure_justification: str
    source: str
    taxonomy_mappings: str
    # VerifyWise-equivalent fields
    risk_owner: Optional[str]
    ai_lifecycle_phase: Optional[str]
    impact: str
    risk_level_autocalculated: Optional[str]
    residual_likelihood: Optional[str]
    residual_severity: Optional[str]
    final_risk_level: Optional[str]
    residual_status: str
    date_of_assessment: Optional[datetime]
    # Issue #187: responsible role, deadline, confirmation state
    responsible_role: Optional[str]
    deadline: Optional[datetime]
    engineer_confirmed: bool
    officer_confirmed: bool
    engineer_email: Optional[str] = None
    officer_email: Optional[str] = None
    engineer_declined: bool = False
    officer_declined: bool = False
    library_risk_id: Optional[str] = None
    misuse_scenarios: list[MisuseScenarioOut] = []
    mitigations: list[MitigationMeasureOut] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RiskEntryPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    article_9_step: Optional[str] = None
    severity: Optional[str] = None
    likelihood: Optional[str] = None
    status: Optional[str] = None
    review_notes: Optional[str] = None
    affects_vulnerable_groups: Optional[bool] = None
    vulnerable_groups: Optional[str] = None
    closure_justification: Optional[str] = None
    source: Optional[str] = None
    taxonomy_mappings: Optional[str] = None
    risk_owner: Optional[str] = None
    ai_lifecycle_phase: Optional[str] = None
    impact: Optional[str] = None
    risk_level_autocalculated: Optional[str] = None
    residual_likelihood: Optional[str] = None
    residual_severity: Optional[str] = None
    final_risk_level: Optional[str] = None
    residual_status: Optional[str] = None
    date_of_assessment: Optional[str] = None
    responsible_role: Optional[str] = None
    deadline: Optional[datetime] = None
    engineer_confirmed: Optional[bool] = None
    officer_confirmed: Optional[bool] = None
    engineer_email: Optional[str] = None
    officer_email: Optional[str] = None
    engineer_declined: Optional[bool] = None
    officer_declined: Optional[bool] = None
    library_risk_id: Optional[str] = None


class RiskRegisterIn(BaseModel):
    assessment_scope: str = ""
    notes: str = ""


class RiskRegisterOut(BaseModel):
    id: str
    ai_system_id: str
    status: str
    assessment_scope: str
    residual_risk_acceptable: Optional[bool]
    residual_risk_argument: str
    residual_severity: Optional[str] = None
    residual_likelihood: Optional[str] = None
    residual_final_risk_level: Optional[str] = None
    residual_date_of_identification: Optional[datetime] = None
    approver_username: Optional[str]
    approved_at: Optional[datetime]
    reviewer_username: Optional[str]
    registry_snapshot: str | None = None
    notes: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    last_assessment_completed_at: Optional[datetime]
    next_review_date: Optional[datetime] = None
    risks: list[RiskEntryOut] = []

    model_config = {"from_attributes": True}


class RiskRegisterPatch(BaseModel):
    status: Optional[str] = None
    assessment_scope: Optional[str] = None
    residual_risk_acceptable: Optional[bool] = None
    residual_risk_argument: Optional[str] = None
    residual_severity: Optional[str] = None
    residual_likelihood: Optional[str] = None
    residual_final_risk_level: Optional[str] = None
    residual_date_of_identification: Optional[datetime] = None
    notes: Optional[str] = None
    next_review_date: Optional[datetime] = None
    reviewer_username: Optional[str] = None


class ApproveRegisterIn(BaseModel):
    residual_risk_acceptable: Optional[bool] = None
    residual_risk_argument: str = ""
    registry_snapshot: Optional[str] = None


class SystemRiskSummary(BaseModel):
    """Per-system summary for the systems list view."""
    system_id: str
    system_name: str
    system_tier: Optional[str]
    system_lifecycle: str
    system_org_role: Optional[str]
    active_register_id: Optional[str]
    active_register_status: Optional[str]
    last_assessment_completed_at: Optional[datetime]
    valid_since: Optional[datetime]
    valid_until: Optional[datetime]
    unacknowledged_triggers: int
    reassessment_needed: bool
    registry_changed: bool = False
    unconfirmed_risks: int = 0
    total_risks: int = 0
    open_risks: int = 0
    traffic_light: str
    # "red" | "orange" | "green"

    model_config = {"from_attributes": True}


class ReassessmentTriggerOut(BaseModel):
    id: str
    ai_system_id: str
    trigger_type: str
    trigger_reason: str
    triggered_at: datetime
    acknowledged: bool
    acknowledged_by: Optional[str]
    acknowledged_at: Optional[datetime]
    new_register_id: Optional[str]

    model_config = {"from_attributes": True}


class TestReportIn(BaseModel):
    title: str
    summary: str = ""
    findings: str = ""
    result: str = "pass"  # "pass" | "fail" | "inconclusive"
    author: Optional[str] = None
    attachments: str = ""  # JSON list of {name, url}
    mitigation_id: Optional[str] = None


class TestReportOut(TestReportIn):
    id: str
    risk_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlanTaskIn(BaseModel):
    title: str
    description: str = ""
    risk_id: Optional[str] = None
    mitigation_id: str | None = None
    assigned_to: Optional[str] = None
    due_date: Optional[datetime] = None
    status: str = "open"


class PlanTaskOut(PlanTaskIn):
    id: str
    register_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlanTaskPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    risk_id: Optional[str] = None
    mitigation_id: str | None = None
    assigned_to: Optional[str] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None


class RiskFieldChange(BaseModel):
    field: str
    from_value: str
    to_value: str


class RegisterDiffEntry(BaseModel):
    title: str
    fields: list[RiskFieldChange] = []
    mitigations_added: list[str] = []
    mitigations_removed: list[str] = []


class RegisterDiff(BaseModel):
    added: list[str] = []
    removed: list[str] = []
    changed: list[RegisterDiffEntry] = []
    mitigations_delta: int = 0


class IncidentIn(BaseModel):
    title: str
    description: str = ""
    status: str = "open"
    risk_id: Optional[str] = None
    reported_by: Optional[str] = None
    occurred_at: Optional[datetime] = None
    attachments: str = ""


class IncidentOut(IncidentIn):
    id: str
    register_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IncidentPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    risk_id: Optional[str] = None
    reported_by: Optional[str] = None
    occurred_at: Optional[datetime] = None
    attachments: Optional[str] = None


class LibraryIncidentOut(BaseModel):
    id: str
    risk_id: str
    title: str
    description: str = ""
    occurred_at: Optional[date] = None
    source_url: str = ""
    created_at: datetime

    model_config = {"from_attributes": True}


class LibraryRiskOut(BaseModel):
    id: str
    title: str
    description: str = ""
    category: str = ""
    affects_vulnerable_groups: bool = False
    affects_children: bool = False
    severity: str = "medium"
    likelihood: str = "possible"
    suggested_mitigation: str = ""
    source: str = ""
    created_at: datetime
    updated_at: datetime
    incidents: list[LibraryIncidentOut] = []

    model_config = {"from_attributes": True}


class LibraryRiskIn(BaseModel):
    title: str
    description: str = ""
    category: str = ""
    affects_vulnerable_groups: bool = False
    affects_children: bool = False
    severity: str = "medium"
    likelihood: str = "possible"
    suggested_mitigation: str = ""
    source: str = ""


class RiskCandidateOut(BaseModel):
    risk_id: str
    title: str
    description: str
    category: str
    severity: str
    likelihood: str
    affects_vulnerable_groups: bool
    suggested_mitigation: str
    system_name: str


class LibraryRiskLinkedSystem(BaseModel):
    system_id: str
    system_name: str
    risk_id: str
    severity: str
    likelihood: str
    status: str


class LibraryRiskStats(BaseModel):
    dominant_severity: Optional[str] = None
    dominant_likelihood: Optional[str] = None
    linked_systems: list[LibraryRiskLinkedSystem] = []
