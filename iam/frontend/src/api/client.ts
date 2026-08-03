import type { RoleInfo, UserRole, PermissionsResponse } from "../types";

const API_BASE = import.meta.env.VITE_REGISTRY_API_BASE;
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";

/** Normalise FastAPI error bodies (which may be a string or a validation array) into a readable string. */
function formatDetail(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) =>
        d.msg ? `${(d.loc ?? []).join(".")}: ${d.msg}` : JSON.stringify(d)
      )
      .join("; ");
  }
  return `HTTP ${status}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatDetail(err.detail, res.status));
  }
  return res.status === 204 ? (null as T) : res.json();
}

function json(body: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  getRoles: () => request<RoleInfo[]>("/iam/roles"),
  getUsers: () => request<UserRole[]>("/iam/users"),
  assignRole: (username: string, role: string) =>
    request<UserRole>(`/iam/users/${encodeURIComponent(username)}/role`, {
      method: "PUT",
      ...json({ role }),
    }),
  removeRole: (username: string) =>
    request<null>(`/iam/users/${encodeURIComponent(username)}/role`, { method: "DELETE" }),
  myPermissions: () => request<PermissionsResponse>("/me/permissions"),
};
