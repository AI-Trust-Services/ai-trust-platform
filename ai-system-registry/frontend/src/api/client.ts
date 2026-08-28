import type { AISystem, ModelCard, AISystemFormData, ModelCardFormData, PermissionsResponse, WorkflowStep, UserSummary, ChatMessage, AssistTurnResponse, AssistExtractResponse, ClassificationResult, ReviewNote, ReviewNoteCreate, ReviewNoteUpdate, Framework, Assessment, AssessmentDetail, Obligation, ObligationDetail, Control, ControlDetail, Evidence, EvidenceDetail, SystemNote, SystemNoteCreate, SystemNoteUpdate } from "../types";

const API_BASE = import.meta.env.VITE_REGISTRY_API_BASE;
const USERS_API_BASE = import.meta.env.VITE_USERS_API_BASE;
const COMPLIANCE_API_BASE = import.meta.env.VITE_COMPLIANCE_API_BASE || "/api/compliance/v1";
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";

async function request<T>(path: string, options: RequestInit = {}, base: string = API_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as T) : res.json();
}

export const api = {
  getSystems: () => request<AISystem[]>("/systems?limit=200"),
  getSystem: (id: string) => request<AISystem>(`/systems/${id}`),
  deleteSystem: (id: string) => request<null>(`/systems/${id}`, { method: "DELETE" }),
  updateSystem: (id: string, data: Partial<AISystemFormData>) =>
    request<AISystem>(`/systems/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  intake: (data: AISystemFormData) =>
    request<{ system: AISystem; classification: unknown }>("/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => r.system),

  // AI-assisted registration — one stateless turn (frontend resends transcript + fields).
  assistTurn: (transcript: ChatMessage[], fields: Record<string, unknown>) =>
    request<AssistTurnResponse>("/intake/assist/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, fields }),
    }),

  // AI-assisted registration — extract fields from an uploaded document/image.
  assistExtract: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<AssistExtractResponse>("/intake/assist/extract", { method: "POST", body: fd });
  },

  // Register with AI-collected fields + inferred flags + rationale; returns the classified system.
  intakeAssisted: (data: Record<string, unknown>) =>
    request<{ system: AISystem; classification: ClassificationResult }>("/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  // Engineer AI-assisted registration — one stateless turn, fetches owner fields from DB via system_id.
  engineerAssistTurn: (systemId: string, transcript: ChatMessage[], fields: Record<string, unknown>) =>
    request<AssistTurnResponse>(`/intake/assist/engineer/${encodeURIComponent(systemId)}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, fields }),
    }),

  // Engineer AI-assisted registration — extract technical fields from an uploaded document/image.
  engineerAssistExtract: (systemId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<AssistExtractResponse>(`/intake/assist/engineer/${encodeURIComponent(systemId)}/extract`, { method: "POST", body: fd });
  },

  // Merge field confirmation state — only the keys sent are merged, never replaced wholesale.
  patchFieldConfirmations: (systemId: string, confirmations: Record<string, boolean>) =>
    request<AISystem>(`/systems/${encodeURIComponent(systemId)}/field-confirmations`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmations }),
    }),

  linkModel: (systemId: string, modelId: string) =>
    request<AISystem>(`/systems/${systemId}/model?model_id=${encodeURIComponent(modelId)}`, { method: "PUT" }),
  unlinkModel: (systemId: string) =>
    request<AISystem>(`/systems/${systemId}/model`, { method: "DELETE" }),

  getModels: () => request<ModelCard[]>("/model-cards?limit=200"),
  createModel: (data: ModelCardFormData) =>
    request<ModelCard>("/model-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateModel: (id: string, data: Partial<ModelCardFormData>) =>
    request<ModelCard>(`/model-cards/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteModel: (id: string) => request<null>(`/model-cards/${id}`, { method: "DELETE" }),

  myPermissions: () => request<PermissionsResponse>("/me/permissions", {}, USERS_API_BASE),

  getUsersByRole: (role: string) =>
    request<UserSummary[]>(`/users/by-role?role=${encodeURIComponent(role)}`, {}, USERS_API_BASE),

  getWorkflow: (systemId: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow`),

  submitForReview: (systemId: string, assigneeUsername: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignee_username: assigneeUsername, note: note ?? null }),
    }),

  approveSystem: (systemId: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note ?? null }),
    }),

  rejectSystem: (systemId: string, note: string, assigneeUsername: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, assignee_username: assigneeUsername }),
    }),

  // ── Review Notes (POC feedback) ────────────────────────────────────────────
  reviewNotes: {
    list: (pagePath?: string) => {
      const params = pagePath ? `?page_path=${encodeURIComponent(pagePath)}` : "";
      return request<ReviewNote[]>(`/review-notes${params}`);
    },
    create: (data: ReviewNoteCreate) =>
      request<ReviewNote>("/review-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (id: string, data: ReviewNoteUpdate) =>
      request<ReviewNote>(`/review-notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<{ status: string; id: string }>(`/review-notes/${id}`, { method: "DELETE" }),
    exportUrl: () => `${API_BASE}/review-notes/export`,
  },

  // ── Compliance API (from compliance MFE) ─────────────────────────────────────
  compliance: {
    // Frameworks
    getFrameworks: () => request<Framework[]>("/frameworks", {}, COMPLIANCE_API_BASE),

    // Assessments
    getAssessments: (aiSystemId?: string) => {
      const params = aiSystemId ? `?ai_system_id=${encodeURIComponent(aiSystemId)}` : "";
      return request<Assessment[]>(`/assessments${params}`, {}, COMPLIANCE_API_BASE);
    },
    getAssessment: (id: string) =>
      request<AssessmentDetail>(`/assessments/${id}`, {}, COMPLIANCE_API_BASE),
    createAssessment: (data: { ai_system_id: string; framework_id: string; title: string; type: string; notes: string }) =>
      request<Assessment>("/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }, COMPLIANCE_API_BASE),
    submitAssessment: (id: string) =>
      request<Assessment>(`/assessments/${id}/submit`, { method: "POST" }, COMPLIANCE_API_BASE),
    approveAssessment: (id: string) =>
      request<Assessment>(`/assessments/${id}/approve`, { method: "POST" }, COMPLIANCE_API_BASE),
    deleteAssessment: (id: string) =>
      request<null>(`/assessments/${id}`, { method: "DELETE" }, COMPLIANCE_API_BASE),

    // Obligations
    getObligations: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request<Obligation[]>(`/obligations${qs ? `?${qs}` : ""}`, {}, COMPLIANCE_API_BASE);
    },
    getObligation: (id: string) =>
      request<ObligationDetail>(`/obligations/${id}`, {}, COMPLIANCE_API_BASE),
    updateObligation: (id: string, data: Partial<Obligation>) =>
      request<Obligation>(`/obligations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }, COMPLIANCE_API_BASE),

    // Controls
    getControls: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request<Control[]>(`/controls${qs ? `?${qs}` : ""}`, {}, COMPLIANCE_API_BASE);
    },
    getControl: (id: string) =>
      request<ControlDetail>(`/controls/${id}`, {}, COMPLIANCE_API_BASE),
    updateControl: (id: string, data: Partial<Control>) =>
      request<Control>(`/controls/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }, COMPLIANCE_API_BASE),

    // Evidence
    getEvidence: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request<Evidence[]>(`/evidence${qs ? `?${qs}` : ""}`, {}, COMPLIANCE_API_BASE);
    },
    getEvidenceItem: (id: string) =>
      request<EvidenceDetail>(`/evidence/${id}`, {}, COMPLIANCE_API_BASE),
    approveEvidence: (id: string) =>
      request<Evidence>(`/evidence/${id}/approve`, { method: "POST" }, COMPLIANCE_API_BASE),
    rejectEvidence: (id: string) =>
      request<Evidence>(`/evidence/${id}/reject`, { method: "POST" }, COMPLIANCE_API_BASE),
    getDownloadUrl: (id: string) =>
      request<{ url: string; expires_hours: number }>(`/evidence/${id}/download-url`, {}, COMPLIANCE_API_BASE),
  },

  // ── System Notes ─────────────────────────────────────────────────────────────
  systemNotes: {
    list: (systemId: string) =>
      request<SystemNote[]>(`/systems/${systemId}/notes`),
    create: (systemId: string, data: SystemNoteCreate) =>
      request<SystemNote>(`/systems/${systemId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (systemId: string, noteId: string, data: SystemNoteUpdate) =>
      request<SystemNote>(`/systems/${systemId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    delete: (systemId: string, noteId: string) =>
      request<void>(`/systems/${systemId}/notes/${noteId}`, { method: "DELETE" }),
  },
};
