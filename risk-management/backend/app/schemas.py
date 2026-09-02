from __future__ import annotations

from datetime import datetime
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
    risk_type: str = "known"  # "known" | "foreseeable"
    severity: str = "medium"
    likelihood: str = "possible"
    status: str = "identified"
    review_notes: str = ""
    affects_vulnerable_groups: bool = False
    vulnerable_groups: str = ""  # JSON list
    closure_justification: str = ""
    source: str = "manual"
    taxonomy_mappings: str = ""  # JSON list
    misuse_scenarios: list[MisuseScenarioIn] = []
    mitigations: list[MitigationMeasureIn] = []


class RiskEntryOut(BaseModel):
    id: str
    register_id: str
    title: str
    description: str
    category: str
    article_9_step: str
    risk_type: str
    severity: str
    likelihood: str
    status: str
    review_notes: str
    affects_vulnerable_groups: bool
    vulnerable_groups: str
    closure_justification: str
    source: str
    taxonomy_mappings: str
    misuse_scenarios: list[MisuseScenarioOut] = []
    mitigations: list[MitigationMeasureOut] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


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
    approver_username: Optional[str]
    approved_at: Optional[datetime]
    notes: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    last_assessment_completed_at: Optional[datetime]
    risks: list[RiskEntryOut] = []

    model_config = {"from_attributes": True}


class RiskRegisterPatch(BaseModel):
    status: Optional[str] = None
    assessment_scope: Optional[str] = None
    residual_risk_acceptable: Optional[bool] = None
    residual_risk_argument: Optional[str] = None
    notes: Optional[str] = None


class ApproveRegisterIn(BaseModel):
    residual_risk_acceptable: bool
    residual_risk_argument: str = ""


class SystemRiskSummary(BaseModel):
    """Per-system summary for the systems list view."""
    system_id: str
    system_name: str
    system_tier: str
    system_lifecycle: str
    active_register_id: Optional[str]
    active_register_status: Optional[str]
    last_assessment_completed_at: Optional[datetime]
    unacknowledged_triggers: int
    reassessment_needed: bool
    # True when: no register, >6mo since last assessment, or unacknowledged trigger

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
