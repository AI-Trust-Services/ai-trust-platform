import type {
  AISystem, Assessment, AssessmentDetail, Control, ControlDetail,
  Evidence, EvidenceDetail, EvidenceVersion, Framework, GenerateObligationsResponse,
  DownloadUrlResponse, Obligation, ObligationDetail, PermissionsResponse,
} from "../types";

const API_BASE = import.meta.env.VITE_COMPLIANCE_API_BASE as string;
const REGISTRY_API_BASE = import.meta.env.VITE_REGISTRY_API_BASE as string;
const USERS_API_BASE = import.meta.env.VITE_USERS_API_BASE as string;
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

async function request<T>(base: string, path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, options);
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

type QueryParams = Record<string, string | undefined>;
function qs(params: QueryParams): string {
  const p = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))
  ).toString();
  return p ? `?${p}` : "";
}

export const api = {
  // Registry (read-only)
  getSystems: (): Promise<AISystem[]> =>
    request<AISystem[]>(REGISTRY_API_BASE, "/systems?limit=200"),

  // Frameworks
  getFrameworks: (): Promise<Framework[]> =>
    request<Framework[]>(API_BASE, "/frameworks"),
  toggleFramework: (id: string, enabled: boolean): Promise<Framework> =>
    request<Framework>(API_BASE, `/frameworks/${id}`, json("PATCH", { enabled })),

  // Assessments
  getAssessments: (aiSystemId?: string): Promise<Assessment[]> =>
    request<Assessment[]>(API_BASE, `/assessments${qs({ ai_system_id: aiSystemId })}`),
  getAssessment: (id: string): Promise<AssessmentDetail> =>
    request<AssessmentDetail>(API_BASE, `/assessments/${id}`),
  createAssessment: (data: {
    ai_system_id: string; framework_id: string; title: string; type: string; notes: string;
  }): Promise<Assessment> =>
    request<Assessment>(API_BASE, "/assessments", json("POST", data)),
  updateAssessment: (id: string, data: Partial<Assessment>): Promise<Assessment> =>
    request<Assessment>(API_BASE, `/assessments/${id}`, json("PUT", data)),
  deleteAssessment: (id: string): Promise<null> =>
    request<null>(API_BASE, `/assessments/${id}`, { method: "DELETE" }),
  generateObligations: (id: string): Promise<GenerateObligationsResponse> =>
    request<GenerateObligationsResponse>(API_BASE, `/assessments/${id}/generate-obligations`, { method: "POST" }),
  submitAssessment: (id: string): Promise<Assessment> =>
    request<Assessment>(API_BASE, `/assessments/${id}/submit`, { method: "POST" }),
  approveAssessment: (id: string): Promise<Assessment> =>
    request<Assessment>(API_BASE, `/assessments/${id}/approve`, { method: "POST" }),

  // Obligations
  getObligations: (params: QueryParams = {}): Promise<Obligation[]> =>
    request<Obligation[]>(API_BASE, `/obligations${qs(params)}`),
  getObligation: (id: string): Promise<ObligationDetail> =>
    request<ObligationDetail>(API_BASE, `/obligations/${id}`),
  createObligation: (data: {
    assessment_id: string; title: string; article_ref: string;
    description: string; owner: string; due_date: string | null;
  }): Promise<Obligation> =>
    request<Obligation>(API_BASE, "/obligations", json("POST", data)),
  updateObligation: (id: string, data: Partial<Obligation>): Promise<Obligation> =>
    request<Obligation>(API_BASE, `/obligations/${id}`, json("PUT", data)),
  deleteObligation: (id: string): Promise<null> =>
    request<null>(API_BASE, `/obligations/${id}`, { method: "DELETE" }),

  // Controls
  getControls: (params: QueryParams = {}): Promise<Control[]> =>
    request<Control[]>(API_BASE, `/controls${qs(params)}`),
  getControl: (id: string): Promise<ControlDetail> =>
    request<ControlDetail>(API_BASE, `/controls/${id}`),
  createControl: (data: {
    ai_system_id: string | null; title: string; description: string;
    category: string; owner: string; due_date: string | null;
  }): Promise<Control> =>
    request<Control>(API_BASE, "/controls", json("POST", data)),
  updateControl: (id: string, data: Partial<Control>): Promise<Control> =>
    request<Control>(API_BASE, `/controls/${id}`, json("PUT", data)),
  deleteControl: (id: string): Promise<null> =>
    request<null>(API_BASE, `/controls/${id}`, { method: "DELETE" }),
  linkObligation: (controlId: string, obligationId: string): Promise<ControlDetail> =>
    request<ControlDetail>(API_BASE, `/controls/${controlId}/link/${obligationId}`, { method: "POST" }),
  unlinkObligation: (controlId: string, obligationId: string): Promise<ControlDetail> =>
    request<ControlDetail>(API_BASE, `/controls/${controlId}/link/${obligationId}`, { method: "DELETE" }),

  // Evidence
  getEvidence: (params: QueryParams = {}): Promise<Evidence[]> =>
    request<Evidence[]>(API_BASE, `/evidence${qs(params)}`),
  getEvidenceItem: (id: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}`),
  uploadEvidence: (formData: FormData): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, "/evidence", { method: "POST", body: formData }),
  updateEvidence: (id: string, data: Partial<Evidence>): Promise<Evidence> =>
    request<Evidence>(API_BASE, `/evidence/${id}`, json("PUT", data)),
  deleteEvidence: (id: string): Promise<null> =>
    request<null>(API_BASE, `/evidence/${id}`, { method: "DELETE" }),
  approveEvidence: (id: string): Promise<Evidence> =>
    request<Evidence>(API_BASE, `/evidence/${id}/approve`, { method: "POST" }),
  rejectEvidence: (id: string): Promise<Evidence> =>
    request<Evidence>(API_BASE, `/evidence/${id}/reject`, { method: "POST" }),
  getDownloadUrl: (id: string): Promise<DownloadUrlResponse> =>
    request<DownloadUrlResponse>(API_BASE, `/evidence/${id}/download-url`),
  getEvidenceVersions: (id: string): Promise<EvidenceVersion[]> =>
    request<EvidenceVersion[]>(API_BASE, `/evidence/${id}/versions`),
  uploadEvidenceVersion: (id: string, formData: FormData): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/upload-version`, { method: "POST", body: formData }),
  linkEvidenceSystem: (id: string, systemId: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/systems/${systemId}`, { method: "POST" }),
  unlinkEvidenceSystem: (id: string, systemId: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/systems/${systemId}`, { method: "DELETE" }),
  linkEvidenceAssessment: (id: string, assessmentId: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/assessments/${assessmentId}`, { method: "POST" }),
  unlinkEvidenceAssessment: (id: string, assessmentId: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/assessments/${assessmentId}`, { method: "DELETE" }),
  linkEvidenceControl: (id: string, controlId: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/controls/${controlId}`, { method: "POST" }),
  unlinkEvidenceControl: (id: string, controlId: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/controls/${controlId}`, { method: "DELETE" }),
  linkEvidenceObligation: (id: string, obligationId: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/obligations/${obligationId}`, { method: "POST" }),
  unlinkEvidenceObligation: (id: string, obligationId: string): Promise<EvidenceDetail> =>
    request<EvidenceDetail>(API_BASE, `/evidence/${id}/obligations/${obligationId}`, { method: "DELETE" }),

  // Current user's effective permissions — served by the registry backend.
  myPermissions: (): Promise<PermissionsResponse> =>
    request<PermissionsResponse>(USERS_API_BASE, "/me/permissions"),
};
