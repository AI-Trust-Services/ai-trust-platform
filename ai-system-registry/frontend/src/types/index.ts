export type TierKey = "prohibited" | "gpai-systemic" | "gpai-standard" | "high" | "limited" | "minimal" | "pending";
export type LifecycleKey = "development" | "testing" | "prod_ready" | "market" | "service" | "updated" | "decommissioned";
export type OrgRole = "provider" | "deployer" | "both" | "importer" | "distributor" | "authorised_representative";
export type SystemType = "application" | "model" | "component" | "service";
export type AutonomyLevel = "decision_support" | "human_in_the_loop" | "human_on_the_loop" | "fully_automated";
export type WorkflowStatus = "draft" | "business_pending" | "technical_pending" | "pending_review" | "info_requested" | "approved" | "rejected";
export type RegistrationMode = "ai" | "manual_questionnaire" | "full_manual";

export interface AISystem {
  id: string;
  name: string;
  version: string;
  provider: string;
  org_name: string;
  org_role: OrgRole;
  provider_country: string;
  deployment_country: string | null;
  eu_output_usage: boolean | null;
  eu_market_placement: boolean | null;
  system_type: SystemType;
  autonomy_level: AutonomyLevel;
  lifecycle: LifecycleKey;
  application_url: string;
  description: string;
  intended_purpose: string;
  department: string | null;
  use_case: string | null;
  people_affected: string | null;
  decision_context: string | null;
  tier: TierKey;
  basis: string;
  annex_iii_area: number | null;
  compliance: number;
  created_at: string;
  updated_at: string;
  workflow_status: WorkflowStatus;
  registration_mode: RegistrationMode;
  assignee_username: string | null;
  compliance_officer_username: string | null;
  business_assignee_username: string | null;
  technical_assignee_username: string | null;
  // Business answers live at the top level; technical free-text answers (AI mode)
  // are nested under the "technical" key. Values are strings except that nesting.
  questionnaire_answers: Record<string, unknown> | null;
  registration_documents: RegistrationDocument[] | null;
  // Two shapes: legacy bare RationaleItem[] (AI-assisted intake) or the extended
  // ClassificationRationale object (questionnaire workflow, CO-only). Discriminate
  // with Array.isArray().
  classification_rationale: RationaleItem[] | ClassificationRationale | null;
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
  field_confirmations: Record<string, boolean> | null;
}

export interface WorkflowStep {
  id: string;
  step: string;
  actor_username: string;
  assignee_username: string | null;
  note: string | null;
  created_at: string;
}

export interface QuestionAssignment {
  id: string;
  section: string;
  question_key: string;
  assignee_username: string;
  assigned_by_username: string;
  assigned_at: string;
  answered_at: string | null;
}

export interface UserSummary {
  username: string;
  firstName: string;
  lastName: string;
}

// ── Model Card (new rich schema) ─────────────────────────────────────────────

export interface Metric {
  id: string;
  value: number;
  name: string;
  dataset: string | null;
  config: string | null;
  args: Record<string, unknown> | null;
}

export interface Source {
  id: string;
  url: string;
  name: string | null;
}

export interface Preparation {
  id: string;
  order: number;
  operation: string;
  description: string | null;
}

export interface Measurement {
  id: string;
  measure: string;
  value: string;
}

export interface FeatureStoreGroup {
  id: string;
  name: string;
  version: string | null;
  origin: string | null;
}

export interface FeatureStore {
  id: string;
  store_name: string;
  groups: FeatureStoreGroup[];
}

export interface Dataset {
  id: string;
  name: string;
  type: "train" | "val" | "test" | "train_cv";
  revision: string | null;
  origin: string | null;
  is_personal_data: boolean | null;
  assumptions: string | null;
  assessment_availability: string | null;
  assessment_quantity: string | null;
  assessment_suitability: string | null;
  potential_biases: string | null;
  preparations: Preparation[];
  measurements: Measurement[];
  feature_stores: FeatureStore[];
}

export interface ModelCard {
  id: string;
  name: string;
  version: string | null;
  base_model: string | null;
  library_name: string | null;
  license: string | null;
  license_name: string | null;
  license_link: string | null;
  training_commit: string | null;
  validation_status: string | null;
  task_type: string | null;
  task_name: string | null;
  tags: string[];
  metrics: Metric[];
  sources: Source[];
  datasets: Dataset[];
  created_at: string;
  updated_at: string;
}

// Create / patch shapes sent to the API
export interface ModelCardCreate {
  name: string;
}

export interface ModelCardPatch {
  name?: string;
  version?: string | null;
  base_model?: string | null;
  library_name?: string | null;
  license?: string | null;
  license_name?: string | null;
  license_link?: string | null;
  training_commit?: string | null;
  validation_status?: string | null;
  task_type?: string | null;
  task_name?: string | null;
  tags?: string[];
}

export interface MetricCreate {
  value: number;
  name: string;
  dataset?: string | null;
  config?: string | null;
}

export interface SourceCreate {
  url: string;
  name?: string | null;
}

export interface PreparationCreate {
  operation: string;
  description?: string | null;
}

export interface MeasurementCreate {
  measure: string;
  value: string;
}

export interface FeatureStoreGroupCreate {
  name: string;
  version?: string | null;
  origin?: string | null;
}

export interface FeatureStoreCreate {
  store_name: string;
  groups: FeatureStoreGroupCreate[];
}

export interface DatasetCreate {
  name: string;
  type: "train" | "val" | "test" | "train_cv";
  revision?: string | null;
  origin?: string | null;
  is_personal_data?: boolean | null;
  assumptions?: string | null;
  assessment_availability?: string | null;
  assessment_quantity?: string | null;
  assessment_suitability?: string | null;
  potential_biases?: string | null;
  preparations?: PreparationCreate[];
  measurements?: MeasurementCreate[];
  feature_stores?: FeatureStoreCreate[];
}

export interface DatasetPatch {
  name?: string | null;
  type?: "train" | "val" | "test" | "train_cv" | null;
  revision?: string | null;
  origin?: string | null;
  is_personal_data?: boolean | null;
  assumptions?: string | null;
  assessment_availability?: string | null;
  assessment_quantity?: string | null;
  assessment_suitability?: string | null;
  potential_biases?: string | null;
}

export interface ModelSystemResponse {
  id: string;
  name: string;
  tier: string;
  lifecycle: string;
  compliance: number;
  role: string | null;
}

export interface PreviewResult {
  tier: TierKey;
  basis: string;
  obligations: string[];
}

// ── AI-assisted registration ──────────────────────────────────────────────
export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface RationaleItem {
  flag: string;
  value: boolean | number;
  rationale: string;
  confidence: number;
}

// Extended classification output from the questionnaire workflow — visible only
// to the compliance officer. Distinct from the legacy bare RationaleItem[].
export interface ClassificationRationale {
  flags: RationaleItem[];
  confidence: number | null;
  reasoning: string | null;
  missing_info: string[];
  org_role?: string;
  org_role_rationale?: string;
}

// One supporting document uploaded in the full-manual override flow.
export interface RegistrationDocument {
  filename: string;
  minio_key: string;
  uploaded_at: string;
}

export interface ClassificationResult {
  tier: TierKey;
  basis: string;
  obligations: string[];
  annex_iii_area: number | null;
}

export interface AssistTurnResponse {
  message: string;
  extracted_fields: Record<string, unknown>;
  next_field: string | null;
  complete: boolean;
  degraded: boolean;
  inferred_flags: RationaleItem[] | null;
  classification: ClassificationResult | null;
}

export interface AssistExtractResponse {
  extracted_fields: Record<string, unknown>;
  notes: string | null;
}

export interface AISystemFormData {
  name: string;
  version: string;
  provider: string;
  org_name: string;
  org_role: OrgRole;
  provider_country: string;
  deployment_country: string;
  eu_output_usage: boolean | null;
  eu_market_placement: boolean | null;
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

export interface PermissionsResponse {
  username: string;
  permissions: string[];
}

