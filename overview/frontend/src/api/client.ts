/** Read a required build-time env var; throw if missing so misconfiguration fails loudly. */
function requireEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const API_BASE = requireEnv("VITE_OVERVIEW_API_BASE");
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";
export const REGISTRY_URL = requireEnv("VITE_REGISTRY_URL");
export const COMPLIANCE_URL = requireEnv("VITE_COMPLIANCE_URL");
const USERS_API_BASE = requireEnv("VITE_USERS_API_BASE");
const REGISTRY_API_BASE = requireEnv("VITE_REGISTRY_API_BASE");
const COMPLIANCE_API_BASE = requireEnv("VITE_COMPLIANCE_API_BASE");

async function request<T>(path: string, base: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface MeResponse {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
}

export interface OrganizationContact {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface OrganizationContactsResponse {
  compliance_officer: OrganizationContact | null;
  organization_admin: OrganizationContact | null;
}

export interface OpenTaskRow {
  source: "required" | "assigned";
  system_id: string;
  system_name: string;
  system_version: string;
  section: string;
  workflow_status: string | null;
  question_key: string;
  question_label: string;
  assigned_at: string;
  assigned_by_username: string | null;
  owner_username: string | null;
  assignment_id?: string | null;
}

export interface MySystemRow {
  id: string;
  name: string;
  tier: string;
  workflow_status: string;
  is_chatbot: boolean;
  generates_synthetic_content: boolean;
  business_owners: string | null;
  contributors: string[];
  assignee_username: string | null;
  business_assignee_username: string | null;
  technical_assignee_username: string | null;
  compliance_officer_username: string | null;
  updated_at: string | null;
  created_at: string | null;
}

export interface AssessmentSummary {
  id: string;
  ai_system_id: string;
  status: string;
  framework_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export const api = {
  myPermissions: () =>
    request<{ permissions: string[] }>("/me/permissions", USERS_API_BASE),
  me: () => request<MeResponse>("/me", USERS_API_BASE),
  organizationContacts: () =>
    request<OrganizationContactsResponse>("/me/organization-contacts", USERS_API_BASE),
  myOpenTasks: () => request<OpenTaskRow[]>("/me/open-tasks", REGISTRY_API_BASE),
  mySystems: () => request<MySystemRow[]>("/me/systems", REGISTRY_API_BASE),
  allAssessments: () =>
    request<AssessmentSummary[]>("/assessments?limit=500", COMPLIANCE_API_BASE),
};
