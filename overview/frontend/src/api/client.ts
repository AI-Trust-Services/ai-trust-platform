import type { AlertEvent, ComplianceStats, OverviewStats } from "../types";

/** Read a required build-time env var; throw if missing so misconfiguration fails loudly. */
function requireEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const API_BASE = requireEnv("VITE_OVERVIEW_API_BASE");
export const HEALTH_URL = API_BASE.replace("/api/v1", "") + "/health";
export const ALERTS_API_BASE = requireEnv("VITE_ALERTS_API_BASE");
export const ALERTS_URL = requireEnv("VITE_ALERTS_URL");
export const REGISTRY_URL = requireEnv("VITE_REGISTRY_URL");
export const COMPLIANCE_URL = requireEnv("VITE_COMPLIANCE_URL");

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
