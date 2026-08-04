import type { AlertEvent, ComplianceStats, OverviewStats } from "../types";

/** Read a required build-time env var; throw if missing so misconfiguration fails loudly. */
function requireEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const API_BASE = requireEnv("VITE_OVERVIEW_API_BASE");
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";
export const ALERTS_API_BASE = requireEnv("VITE_ALERTS_API_BASE");
export const COMPLIANCE_API_BASE = requireEnv("VITE_COMPLIANCE_API_BASE");
export const ALERTS_URL = requireEnv("VITE_ALERTS_URL");
export const REGISTRY_URL = requireEnv("VITE_REGISTRY_URL");
export const COMPLIANCE_URL = requireEnv("VITE_COMPLIANCE_URL");

async function request<T>(path: string, base: string = API_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface AssessmentTrendRow {
  id: string;
  score: number | null;
  updated_at: string;
  status: string;
}

export const api = {
  getStats: () => request<OverviewStats>("/stats"),
  getComplianceStats: (windowDays = 30) =>
    request<ComplianceStats>(`/compliance-stats?window_days=${windowDays}`),
  // Alerts and assessments live on separate backends; route through request<T>() for
  // type safety and consistent error handling. Callers decide how to degrade if a
  // dependency is unavailable (the dashboard tolerates these failures without failing
  // the whole page).
  getActiveAlerts: () => request<AlertEvent[]>("/active", ALERTS_API_BASE),
  getAlertCount: () => request<{ count: number }>("/count", ALERTS_API_BASE),
  // Scope to the trend window via updated_after so the query is time-bounded rather
  // than relying on the limit=500 cap (which would silently truncate over time).
  getAssessments: (updatedAfter: string) =>
    request<AssessmentTrendRow[]>(
      `/assessments?updated_after=${updatedAfter}&limit=500`,
      COMPLIANCE_API_BASE,
    ),
};