import type {
  SystemRiskSummary,
  RiskRegister,
  RiskEntry,
  MisuseScenario,
  MitigationMeasure,
  ReassessmentTrigger,
} from "../types";

const BASE = import.meta.env.VITE_RISK_MANAGEMENT_API_BASE ?? "/api/risk-management/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* ignore */ }
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

export const api = {
  // Systems list
  getSystems: () => request<SystemRiskSummary[]>("/systems"),

  // Registers
  getRegisters: (systemId: string) => request<RiskRegister[]>(`/systems/${systemId}/registers`),
  getRegister: (registerId: string) => request<RiskRegister>(`/registers/${registerId}`),
  createRegister: (systemId: string, body: { assessment_scope?: string; notes?: string }) =>
    request<RiskRegister>(`/systems/${systemId}/registers`, { method: "POST", ...json(body) }),
  patchRegister: (registerId: string, body: Partial<RiskRegister>) =>
    request<RiskRegister>(`/registers/${registerId}`, { method: "PATCH", ...json(body) }),
  approveRegister: (registerId: string, body: { residual_risk_acceptable: boolean; residual_risk_argument: string }) =>
    request<RiskRegister>(`/registers/${registerId}/approve`, { method: "POST", ...json(body) }),

  // Risks
  getRisks: (registerId: string) => request<RiskEntry[]>(`/registers/${registerId}/risks`),
  createRisk: (registerId: string, body: Partial<RiskEntry>) =>
    request<RiskEntry>(`/registers/${registerId}/risks`, { method: "POST", ...json(body) }),
  patchRisk: (riskId: string, body: Partial<RiskEntry>) =>
    request<RiskEntry>(`/risks/${riskId}`, { method: "PATCH", ...json(body) }),
  deleteRisk: (riskId: string) => request<void>(`/risks/${riskId}`, { method: "DELETE" }),

  // Misuse scenarios
  addMisuseScenario: (riskId: string, body: Omit<MisuseScenario, "id">) =>
    request<MisuseScenario>(`/risks/${riskId}/misuse-scenarios`, { method: "POST", ...json(body) }),
  deleteMisuseScenario: (scenarioId: string) =>
    request<void>(`/misuse-scenarios/${scenarioId}`, { method: "DELETE" }),

  // Mitigations
  addMitigation: (riskId: string, body: Omit<MitigationMeasure, "id">) =>
    request<MitigationMeasure>(`/risks/${riskId}/mitigations`, { method: "POST", ...json(body) }),
  patchMitigation: (mitId: string, body: Partial<MitigationMeasure>) =>
    request<MitigationMeasure>(`/mitigations/${mitId}`, { method: "PATCH", ...json(body) }),
  deleteMitigation: (mitId: string) => request<void>(`/mitigations/${mitId}`, { method: "DELETE" }),

  // Triggers
  getTriggers: (systemId: string) => request<ReassessmentTrigger[]>(`/systems/${systemId}/triggers`),
  acknowledgeTrigger: (triggerId: string) =>
    request<ReassessmentTrigger>(`/triggers/${triggerId}/acknowledge`, { method: "POST" }),
};
