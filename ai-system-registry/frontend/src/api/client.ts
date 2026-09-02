import type { AISystem, ModelCard, AISystemFormData, ModelCardFormData, PermissionsResponse, WorkflowStep, UserSummary, ChatMessage, AssistTurnResponse, AssistExtractResponse, ClassificationResult } from "../types";
import type { SectionKey } from "../config/questionnaire";

const API_BASE = import.meta.env.VITE_REGISTRY_API_BASE;
const USERS_API_BASE = import.meta.env.VITE_USERS_API_BASE;
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

  // Merge questionnaire answers — only the keys sent are merged. section="business"
  // merges at the top level; section="technical" merges into the nested "technical"
  // sub-object (AI-mode free-text technical answers).
  patchQuestionnaireAnswers: (systemId: string, answers: Record<string, string>, section: SectionKey = "business") =>
    request<AISystem>(`/systems/${encodeURIComponent(systemId)}/questionnaire`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, section }),
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

  approveSystem: (systemId: string, note?: string, tier?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note ?? null, tier: tier ?? null }),
    }),

  rejectSystem: (systemId: string, note: string, assigneeUsername: string, sendTo: "business" | "technical" = "business") =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, assignee_username: assigneeUsername, send_to: sendTo }),
    }),

  // New questionnaire workflow endpoints.
  assignWorkflow: (systemId: string, body: { business_assignee_username: string; technical_assignee_username: string; compliance_officer_username: string; note?: string }) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  submitBusinessSection: (systemId: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/submit-business`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note ?? null }),
    }),

  submitTechnicalSection: (systemId: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/submit-technical`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note ?? null }),
    }),

  // Questionnaire chatbot — stateful, system must exist in DB.
  questionnaireTurn: (systemId: string, section: SectionKey, transcript: ChatMessage[], fields: Record<string, unknown>) =>
    request<AssistTurnResponse>(`/intake/assist/questionnaire/${encodeURIComponent(systemId)}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, transcript, fields }),
    }),

  questionnaireExtract: (systemId: string, section: SectionKey, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<AssistExtractResponse>(`/intake/assist/questionnaire/${encodeURIComponent(systemId)}/extract?section=${section}`, { method: "POST", body: fd });
  },

  // CO sends a system back to a specific contributor for more information.
  requestInfo: (systemId: string, contributorUsername: string, note: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/request-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contributor_username: contributorUsername, note }),
    }),

  // Contributor returns an info-requested system to the CO.
  submitInfo: (systemId: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/submit-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note ?? null }),
    }),

  // Section owner hands a section to a contributor (task handoff).
  subAssign: (systemId: string, section: SectionKey, subAssigneeUsername: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/sub-assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, sub_assignee_username: subAssigneeUsername, note: note ?? null }),
    }),

  // Contributor marks a sub-assigned section complete, returning it to the owner.
  subComplete: (systemId: string, section: SectionKey, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/sub-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, note: note ?? null }),
    }),

  // Section owner cancels an active sub-assignment and reclaims editing.
  subReclaim: (systemId: string, section: SectionKey, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/sub-reclaim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, note: note ?? null }),
    }),

  // Full-manual supporting documents.
  uploadDocument: (systemId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<AISystem>(`/systems/${encodeURIComponent(systemId)}/documents`, { method: "POST", body: fd });
  },

  getDocumentDownloadUrl: (systemId: string, docIndex: number) =>
    request<{ url: string }>(`/systems/${encodeURIComponent(systemId)}/documents/${docIndex}/download-url`),
};

