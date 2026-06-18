import type { AlertEvent, AlertRule, AlertCount } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE as string;
export const HEALTH_URL = API_BASE.replace("/api/v1", "") + "/health";
export const ALERTS_URL = (import.meta.env.VITE_ALERTS_URL as string) || "http://localhost:3004";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as T) : res.json();
}

export const api = {
  getActiveAlerts: () => request<AlertEvent[]>("/alerts/active"),
  getAlertHistory: () => request<AlertEvent[]>("/alerts/history"),
  getAlertRules:   () => request<AlertRule[]>("/alerts/rules"),
  getAlertCount:   () => request<AlertCount>("/alerts/count"),

  handleEvent: (eventId: string) =>
    request<{ status: string }>(`/alerts/events/${eventId}/handle`, { method: "POST" }),

  toggleRule: (ruleId: string) =>
    request<{ rule_id: string; enabled: boolean }>(`/alerts/rules/${ruleId}/toggle`, { method: "POST" }),
};
