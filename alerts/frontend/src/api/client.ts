import type { AlertEvent, AlertRule, AlertCount, PermissionsResponse } from "../types";

const API_BASE = import.meta.env.VITE_ALERTS_API_BASE as string;
const REGISTRY_API_BASE = import.meta.env.VITE_REGISTRY_API_BASE as string;
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";
export const ALERTS_URL = (import.meta.env.VITE_ALERTS_URL as string) || "http://localhost:3004";

async function requestBase<T>(base: string, path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as T) : res.json();
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestBase<T>(API_BASE, path, options);
}

export const api = {
  getActiveAlerts: () => request<AlertEvent[]>("/active"),
  getAlertHistory: () => request<AlertEvent[]>("/history"),
  getAlertRules:   () => request<AlertRule[]>("/rules"),
  getAlertCount:   () => request<AlertCount>("/count"),

  handleEvent: (eventId: string) =>
    request<{ status: string }>(`/events/${eventId}/handle`, { method: "POST" }),

  approveModel: (eventId: string) =>
    request<{ status: string }>(`/events/${eventId}/approve-model`, { method: "POST" }),

  rejectModel: (eventId: string) =>
    request<{ status: string }>(`/events/${eventId}/reject-model`, { method: "POST" }),

  toggleRule: (ruleId: string) =>
    request<{ rule_id: string; enabled: boolean }>(`/rules/${ruleId}/toggle`, { method: "POST" }),

  // Current user's effective permissions — served by the registry backend.
  myPermissions: () => requestBase<PermissionsResponse>(REGISTRY_API_BASE, "/me/permissions"),
};
