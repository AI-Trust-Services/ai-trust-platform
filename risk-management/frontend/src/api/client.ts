import type {
  SystemRiskSummary,
  RiskRegister,
  RiskEntry,
  MisuseScenario,
  MitigationMeasure,
  ReassessmentTrigger,
  TestReport,
  PlanTask,
  RegisterDiff,
  Incident,
  RegistrySystemInfo,
  LibraryRisk,
  LibraryRiskStats,
  RiskCandidate,
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
  approveRegister: (registerId: string, body: { residual_risk_acceptable?: boolean | null; residual_risk_argument: string; registry_snapshot?: string | null }) =>
    request<RiskRegister>(`/registers/${registerId}/approve`, { method: "POST", ...json(body) }),
  cloneRegister: (registerId: string) =>
    request<{ new_register_id: string }>(`/registers/${registerId}/clone`, { method: "POST" }),

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

  // Test reports
  getTestReports: (riskId: string) => request<TestReport[]>(`/risks/${riskId}/test-reports`),
  createTestReport: (riskId: string, body: Omit<TestReport, "id" | "risk_id" | "created_at" | "updated_at">) =>
    request<TestReport>(`/risks/${riskId}/test-reports`, { method: "POST", ...json(body) }),
  deleteTestReport: (reportId: string) => request<void>(`/test-reports/${reportId}`, { method: "DELETE" }),

  // Plan tasks
  getPlanTasks: (registerId: string) => request<PlanTask[]>(`/registers/${registerId}/plan-tasks`),
  createPlanTask: (registerId: string, body: Omit<PlanTask, "id" | "register_id" | "created_at" | "updated_at"> & { mitigation_id?: string | null }) =>
    request<PlanTask>(`/registers/${registerId}/plan-tasks`, { method: "POST", ...json(body) }),
  patchPlanTask: (taskId: string, body: Partial<PlanTask>) =>
    request<PlanTask>(`/plan-tasks/${taskId}`, { method: "PATCH", ...json(body) }),
  deletePlanTask: (taskId: string) => request<void>(`/plan-tasks/${taskId}`, { method: "DELETE" }),
  checkOverdueTasks: (registerId: string) =>
    request<void>(`/registers/${registerId}/check-overdue-tasks`, { method: "POST" }),

  // Register diff
  getRegisterDiff: (registerId: string) => request<RegisterDiff>(`/registers/${registerId}/diff`),

  // Registry changes check
  checkRegistryChanges: (registerId: string, currentData: Record<string, unknown>) =>
    request<{ changed: boolean; fields: string[] }>(`/registers/${registerId}/check-registry-changes`, { method: "POST", ...json(currentData) }),

  // Incidents
  getIncidents: (registerId: string) => request<Incident[]>(`/registers/${registerId}/incidents`),
  createIncident: (registerId: string, body: Omit<Incident, "id" | "register_id" | "created_at" | "updated_at">) =>
    request<Incident>(`/registers/${registerId}/incidents`, { method: "POST", ...json(body) }),
  patchIncident: (incidentId: string, body: Partial<Incident>) =>
    request<Incident>(`/incidents/${incidentId}`, { method: "PATCH", ...json(body) }),
  deleteIncident: (incidentId: string) => request<void>(`/incidents/${incidentId}`, { method: "DELETE" }),

  // Registry proxy
  getRegistryInfo: (systemId: string) => request<RegistrySystemInfo>(`/systems/${systemId}/registry-info`),

  // Risk Library
  getRiskLibrary: () => request<LibraryRisk[]>("/risk-library"),
  getRiskLibraryStats: (riskId: string) => request<LibraryRiskStats>(`/risk-library/${riskId}/stats`),
  createLibraryRisk: (body: Omit<LibraryRisk, "id" | "created_at" | "updated_at" | "incidents">) =>
    request<LibraryRisk>("/risk-library", { method: "POST", ...json(body) }),
  getRiskCandidates: () => request<RiskCandidate[]>("/risk-library/candidates"),
};
