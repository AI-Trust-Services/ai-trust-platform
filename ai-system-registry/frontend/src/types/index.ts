export type TierKey = "prohibited" | "gpai-systemic" | "gpai-standard" | "high" | "limited" | "minimal" | "pending";
export type LifecycleKey = "development" | "testing" | "conformity" | "market" | "post-market" | "decommissioned";
export type OrgRole = "provider" | "deployer" | "importer" | "distributor";
export type SystemType = "application" | "model" | "component" | "service";
export type AutonomyLevel = "decision_support" | "human_in_the_loop" | "human_on_the_loop" | "fully_automated";
export type ModelType = "llm" | "embedding" | "multimodal" | "classifier";

export interface AISystem {
  id: string;
  name: string;
  version: string;
  provider: string;
  org_name: string;
  org_role: OrgRole;
  provider_country: string;
  system_type: SystemType;
  autonomy_level: AutonomyLevel;
  lifecycle: LifecycleKey;
  application_url: string;
  description: string;
  intended_purpose: string;
  tier: TierKey;
  basis: string;
  annex_iii_area: number | null;
  compliance: number;
  model_id: string | null;
  created_at: string;
  updated_at: string;
  workflow_status: string;
  assignee_username: string | null;
  is_gpai: boolean;
  training_compute_flops: number;
  is_chatbot: boolean;
  generates_synthetic_content: boolean;
  subliminal_manipulation: boolean;
  exploits_vulnerability: boolean;
  social_scoring_public: boolean;
  real_time_biometric_public: boolean;
  emotion_recognition_workplace: boolean;
  untargeted_facial_scraping: boolean;
  predictive_policing: boolean;
  biometric_categorisation_sensitive: boolean;
  is_biometric_identification: boolean;
  is_critical_infrastructure: boolean;
  is_education_related: boolean;
  is_employment_related: boolean;
  is_credit_scoring: boolean;
  is_public_service: boolean;
  is_law_enforcement: boolean;
  is_migration: boolean;
  is_judicial_admin: boolean;
}

export interface WorkflowStep {
  id: string;
  step: string;
  actor_username: string;
  assignee_username: string | null;
  note: string | null;
  created_at: string;
}

export interface UserSummary {
  username: string;
  firstName: string;
  lastName: string;
}

export interface ModelCard {
  id: string;
  name: string;
  provider: string;
  version: string;
  model_type: ModelType;
  description: string;
  inference_url: string;
  open_weights: boolean;
}

export interface PreviewResult {
  tier: TierKey;
  basis: string;
  obligations: string[];
}

export interface AISystemFormData {
  name: string;
  version: string;
  provider: string;
  org_name: string;
  org_role: OrgRole;
  provider_country: string;
  system_type: SystemType;
  autonomy_level: AutonomyLevel;
  lifecycle: LifecycleKey;
  application_url: string;
  description: string;
  intended_purpose: string;
  is_gpai: boolean;
  training_compute_flops: number;
  is_chatbot: boolean;
  generates_synthetic_content: boolean;
  subliminal_manipulation: boolean;
  exploits_vulnerability: boolean;
  social_scoring_public: boolean;
  real_time_biometric_public: boolean;
  emotion_recognition_workplace: boolean;
  untargeted_facial_scraping: boolean;
  predictive_policing: boolean;
  biometric_categorisation_sensitive: boolean;
  is_biometric_identification: boolean;
  is_critical_infrastructure: boolean;
  is_education_related: boolean;
  is_employment_related: boolean;
  is_credit_scoring: boolean;
  is_public_service: boolean;
  is_law_enforcement: boolean;
  is_migration: boolean;
  is_judicial_admin: boolean;
}

export interface ModelCardFormData {
  name: string;
  provider: string;
  version: string;
  model_type: ModelType;
  description: string;
  inference_url: string;
  open_weights: boolean;
}

export interface PermissionsResponse {
  username: string;
  permissions: string[];
}
