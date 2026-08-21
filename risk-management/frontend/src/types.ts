export interface DemoSummary {
  id: string;
  name: string;
  description: string;
  annex_iii_point: string;
  annex_iii_category: string;
}

export interface DemoSystem extends DemoSummary {
  system_description: string;
  metadata: Record<string, unknown>;
}

export interface LLMStatus {
  available: boolean;
  model: string;
  base_url: string;
}

export interface Risk {
  id: string;
  title: string;
  description: string;
  category: string;
  source: string;
  default_severity: string;
  severity: string;
  likelihood: string;
  affects_vulnerable_groups: boolean;
  vulnerable_groups: string[];
  article_9_step: string;
  confirmed: boolean;
  dismissed: boolean;
  review_notes: string;
  misuse_scenarios: MisuseScenario[];
  taxonomy_mappings: TaxonomyMapping[];
}

export interface MisuseScenario {
  id: string;
  description: string;
  actor: string;
  vulnerable_group: string | null;
  likelihood: string;
  consequence: string;
}

export interface TaxonomyMapping {
  taxonomy: string;
  category: string;
  identifier: string | null;
}

export interface RiskClassification {
  risk_level: string;
  confidence: string;
  annex_iii_match: boolean;
  annex_iii_point: string | null;
  rationale: string;
  source: string;
}

export interface VulnerableGroupAssessment {
  group: string;
  affected: boolean;
  confidence: string;
  evidence: string;
  recommended_safeguards: string[];
  source: string;
}

export interface RelatedIncident {
  aiid_id: string;
  title: string;
  summary: string;
  relevance: string;
  url: string;
}

export interface Mitigation {
  id: string;
  title: string;
  description: string;
  hierarchy_level: string;
  applicable_risk_categories: string[];
  implementation_guidance: string;
  source: string;
  assigned_to_risk_ids: string[];
  user_override: boolean;
  override_notes: string;
}

export interface ResidualRiskArgument {
  claim: string;
  evidence: string[];
  assumptions: string[];
  open_issues: string[];
  overall_verdict: string;
  source: string;
}

export type Step = "demo" | "identify" | "evaluate" | "mitigate" | "export";
