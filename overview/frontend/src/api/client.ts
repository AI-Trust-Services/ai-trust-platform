import type { AlertEvent, ComplianceStats, OverviewStats } from "../types";

const API_BASE = import.meta.env.VITE_OVERVIEW_API_BASE;
export const HEALTH_URL = API_BASE.replace("/api/v1", "") + "/health";
export const ALERTS_API_BASE = import.meta.env.VITE_ALERTS_API_BASE;
export const ALERTS_URL = import.meta.env.VITE_ALERTS_URL || "http://localhost:3004";
export const REGISTRY_URL = import.meta.env.VITE_REGISTRY_URL || "http://localhost:3001";
export const COMPLIANCE_URL = import.meta.env.VITE_COMPLIANCE_URL || "http://localhost:3006";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  getStats: () => request<OverviewStats>("/overview/stats"),
  getComplianceStats: (windowDays = 30) =>
    request<ComplianceStats>(`/overview/compliance-stats?window_days=${windowDays}`),
  getActiveAlerts: (): Promise<AlertEvent[]> =>
    fetch(`${ALERTS_API_BASE}/alerts/active`)
      .then(r => r.ok ? r.json() : [])
      .catch(() => []),
  getAlertCount: () =>
    fetch(`${ALERTS_API_BASE}/alerts/count`).then(r => r.ok ? r.json() : { count: 0 }),
};
