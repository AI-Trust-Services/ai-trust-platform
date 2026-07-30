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

async function request<T>(path: string, base: string = API_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  getStats: () => request<OverviewStats>("/overview/stats"),
  getComplianceStats: (windowDays = 30) =>
    request<ComplianceStats>(`/overview/compliance-stats?window_days=${windowDays}`),
  // Alerts live on a separate backend; route through request<T>() for type safety and
  // consistent error handling. Callers decide how to degrade if alerts is unavailable
  // (the dashboard tolerates alert failures without failing the whole page).
  getActiveAlerts: () => request<AlertEvent[]>("/alerts/active", ALERTS_API_BASE),
  getAlertCount: () => request<{ count: number }>("/alerts/count", ALERTS_API_BASE),
};
