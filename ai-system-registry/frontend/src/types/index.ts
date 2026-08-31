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
  owner_username: string | null;
  assignee_username: string | null;
  compliance_officer_username: string | null;
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

// ── System Actions ────────────────────────────────────────────────────────────

export interface SystemAction {
  label: string;
  href: string;
  external?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "in_progress" | "waiting" | "completed";
export type TaskPriority = "low" | "medium" | "high";
export type TaskType = "registration" | "review" | "compliance";

export interface SystemTask {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  assigneeRole: string;
  stage: string;
  actionHref: string;
  external?: boolean;
}

// ── Review Notes (POC feedback) ───────────────────────────────────────────────

export type ReviewNoteStatus = "pending" | "confirmed" | "rejected" | "done";

export interface ReviewNote {
  id: string;
  page_path: string;
  content: string;
  status: ReviewNoteStatus;
  author_username: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewNoteCreate {
  page_path: string;
  content: string;
}

export interface ReviewNoteUpdate {
  content?: string;
  status?: ReviewNoteStatus;
}

// ── Compliance Types (from compliance MFE) ────────────────────────────────────

export interface Framework {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  created_at: string;
}

export interface Assessment {
  id: string;
  ai_system_id: string;
  framework_id: string;
  title: string;
  type: string;
  status: string;
  score: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface AssessmentDetail extends Assessment {
  obligation_count: number;
  fulfilled_count: number;
}

export interface Obligation {
  id: string;
  assessment_id: string;
  ai_system_id: string;
  framework_id: string;
  title: string;
  article_ref: string;
  description: string;
  status: string;
  due_date: string | null;
  owner: string;
  created_at: string;
  updated_at: string;
}

export interface ObligationDetail extends Obligation {
  control_ids: string[];
}

export interface Control {
  id: string;
  ai_system_id: string | null;
  control_ref: string | null;
  title: string;
  description: string;
  category: string;
  status: string;
  effectiveness: string;
  owner: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ControlDetail extends Control {
  obligation_ids: string[];
  evidence_count: number;
}

export interface Evidence {
  id: string;
  ai_system_id: string | null;
  assessment_id: string | null;
  title: string;
  description: string;
  evidence_type: string;
  status: string;
  validity_from: string | null;
  validity_until: string | null;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  version_label: string;
  created_at: string;
  updated_at: string;
}

export interface EvidenceDetail extends Evidence {
  control_ids: string[];
  obligation_ids: string[];
}

export interface BadgeMeta {
  label: string;
  cls: string;
}

// ── System Notes ──────────────────────────────────────────────────────────────

export interface SystemNote {
  id: string;
  ai_system_id: string;
  content: string;
  author_username: string;
  created_at: string;
  updated_at: string;
}

export interface SystemNoteCreate {
  content: string;
}

export interface SystemNoteUpdate {
  content?: string;
}
