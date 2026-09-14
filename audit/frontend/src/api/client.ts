import type {
  AISystem,
  AuditEventListResponse,
  AuditEventDetail,
  AuditStatsResponse,
  AuditFilters,
  PermissionsResponse,
} from "../types";

const API_BASE = import.meta.env.VITE_AUDIT_API_BASE as string;
const USERS_API_BASE = import.meta.env.VITE_USERS_API_BASE as string;

export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";

async function requestBase<T>(base: string, path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestBase<T>(API_BASE, path, options);
}

// type="date" inputs produce "YYYY-MM-DD". Convert to UTC ISO datetime
// so the backend compares correctly against ClickHouse's UTC timestamps.
// "from" becomes start of day (T00:00:00Z), "to" becomes end of day (T23:59:59Z).
export function normalizeDateFrom(v: string): string {
  if (!v) return v;
  return `${v}T00:00:00Z`;
}
export function normalizeDateTo(v: string): string {
  if (!v) return v;
  return `${v}T23:59:59Z`;
}

function buildQuery(filters: Partial<AuditFilters> & { limit?: number; offset?: number; sort?: string }): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== "") {
      params.set(k, String(v));
    }
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

export const api = {
  listEvents: (
    filters: Partial<AuditFilters> & { limit?: number; offset?: number; sort?: string } = {}
  ) => request<AuditEventListResponse>(`/events${buildQuery(filters)}`),

  getEvent: (id: string) => request<AuditEventDetail>(`/events/${id}`),

  getStats: (from?: string, to?: string) => {
    const params: Record<string, string> = {};
    if (from) params["from"] = from;
    if (to) params["to"] = to;
    return request<AuditStatsResponse>(`/stats${buildQuery(params)}`);
  },

  myPermissions: () => requestBase<PermissionsResponse>(USERS_API_BASE, "/me/permissions"),

  getSystems: (filters: Pick<AuditFilters, "action" | "resource_type" | "from" | "to" | "search"> = {}) =>
    request<AISystem[]>(`/systems${buildQuery(filters)}`),
};
