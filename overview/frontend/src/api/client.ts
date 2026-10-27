/** Read a required build-time env var; throw if missing so misconfiguration fails loudly. */
function requireEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const API_BASE = requireEnv("VITE_OVERVIEW_API_BASE");
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";
export const REGISTRY_URL = requireEnv("VITE_REGISTRY_URL");
const USERS_API_BASE = requireEnv("VITE_USERS_API_BASE");

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

export const api = {
  myPermissions: () =>
    request<{ permissions: string[] }>("/me/permissions", USERS_API_BASE),
  me: () => request<MeResponse>("/me", USERS_API_BASE),
  organizationContacts: () =>
    request<OrganizationContactsResponse>("/me/organization-contacts", USERS_API_BASE),
};
