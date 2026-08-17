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
