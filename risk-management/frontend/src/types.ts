export interface SystemRiskSummary {
  system_id: string;
  system_name: string;
  system_tier: string;
  system_lifecycle: string;
  active_register_id: string | null;
  active_register_status: string | null;
  last_assessment_completed_at: string | null;
  unacknowledged_triggers: number;
  reassessment_needed: boolean;
}

export interface MisuseScenario {
  id: string;
  risk_id?: string;
  actor: string;
  description: string;
  likelihood: string;
  consequence: string;
  vulnerable_group: string | null;
  created_at?: string;
}

export interface MitigationMeasure {
  id: string;
  risk_id?: string;
  title: string;
  description: string;
  hierarchy_level: string;
  implementation_guidance: string;
  status: string;
  assigned_to: string | null;
  due_date: string | null;
  override_notes: string;
  created_at?: string;
  updated_at?: string;
}

export interface RiskEntry {
  id: string;
  register_id: string;
  title: string;
  description: string;
  category: string;
  article_9_step: string;
  risk_type: string;
  severity: string;
  likelihood: string;
  status: string;
  review_notes: string;
  affects_vulnerable_groups: boolean;
  vulnerable_groups: string; // JSON list string
  closure_justification: string;
  source: string;
  taxonomy_mappings: string; // JSON list string
  misuse_scenarios: MisuseScenario[];
  mitigations: MitigationMeasure[];
  created_at: string;
  updated_at: string;
}

export interface RiskRegister {
  id: string;
  ai_system_id: string;
  status: string;
  assessment_scope: string;
  residual_risk_acceptable: boolean | null;
  residual_risk_argument: string;
  approver_username: string | null;
  approved_at: string | null;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_assessment_completed_at: string | null;
  risks: RiskEntry[];
}

export interface ReassessmentTrigger {
  id: string;
  ai_system_id: string;
  trigger_type: string;
  trigger_reason: string;
  triggered_at: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  new_register_id: string | null;
}

export type WizardStep = "scope" | "identify" | "evaluate" | "mitigate" | "approve";
