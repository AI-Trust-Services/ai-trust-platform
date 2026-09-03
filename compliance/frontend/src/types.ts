// Domain model interfaces matching the backend response schemas exactly.

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

export interface EvidenceVersion {
  id: string;
  evidence_id: string;
  version_label: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
}

// Minimal shape from the registry API (read-only, used for pickers)
export interface AISystem {
  id: string;
  name: string;
  tier: string;
  lifecycle: string;
  compliance: number;
  workflow_status: string;
  registration_mode: string;
  org_role: string;
  assignee_username: string | null;
  business_assignee_username: string | null;
  technical_assignee_username: string | null;
  compliance_officer_username: string | null;
  classification_rationale: ClassificationRationale | Array<{ flag: string; value: boolean | number; rationale: string }> | null;
  questionnaire_answers: Record<string, unknown> | null;
  // Risk classification flags
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
  is_gpai: boolean;
  training_compute_flops: number;
  is_chatbot: boolean;
  generates_synthetic_content: boolean;
}

export interface ClassificationRationale {
  reasoning: string | null;
  confidence: number | null;
  org_role: string | null;
  org_role_rationale: string | null;
  missing_info: string[];
  flags: Array<{
    flag: string;
    value: boolean | number;
    confidence: number | null;
    rationale: string | null;
  }>;
}

export interface WorkflowStep {
  id: string;
  system_id: string;
  step: string;
  actor_username: string;
  assignee_username: string | null;
  created_at: string;
}

export interface QuestionAssignment {
  id: string;
  system_id: string;
  section: string;
  question_key: string;
  assignee_username: string;
  assigned_by_username: string;
  assigned_at: string;
  answered_at: string | null;
}

export interface GenerateObligationsResponse {
  created: Obligation[];
  message: string;
}

export interface DownloadUrlResponse {
  url: string;
  expires_hours: number;
}

// Badge metadata shapes
export interface BadgeMeta {
  label: string;
  cls: string;
}

export interface PermissionsResponse {
  username: string;
  permissions: string[];
}
