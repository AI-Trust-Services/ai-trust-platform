import type {
  SmtpSettings,
  SmtpSettingsUpdate,
  SmtpTestRequest,
  SmtpTestResponse,
  GeneralSettings,
  GeneralSettingsUpdate,
} from "../types";

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE as string;
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";

function formatDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(e.loc) ? String(e.loc[e.loc.length - 1]) : "";
        return field ? `${field}: ${e.msg ?? ""}` : (e.msg ?? "");
      })
      .join("; ");
  }
  return String(detail);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: unknown };
    throw new Error(formatDetail(err.detail) || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as unknown as T) : (res.json() as Promise<T>);
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Permissions check uses the users API (shared endpoint, not admin-specific)
const USERS_API = (import.meta.env.VITE_USERS_API_BASE as string | undefined) ?? "/api/users/v1";

export const api = {
  getSmtp: (): Promise<SmtpSettings> =>
    request<SmtpSettings>("/smtp"),

  updateSmtp: (data: SmtpSettingsUpdate): Promise<SmtpSettings> =>
    request<SmtpSettings>("/smtp", json("PUT", data)),

  testSmtp: (data: SmtpTestRequest): Promise<SmtpTestResponse> =>
    request<SmtpTestResponse>("/smtp/test", json("POST", data)),

  getSettings: (): Promise<GeneralSettings> =>
    request<GeneralSettings>("/settings"),

  updateSettings: (data: GeneralSettingsUpdate): Promise<GeneralSettings> =>
    request<GeneralSettings>("/settings", json("PUT", data)),

  myPermissions: (): Promise<{ permissions: string[] }> =>
    fetch(`${USERS_API}/me/permissions`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ permissions: string[] }>)
      .catch(() => ({ permissions: [] })),
};
