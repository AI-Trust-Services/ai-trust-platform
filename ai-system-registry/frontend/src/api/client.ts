import type { AISystem, ModelCard, ModelCardCreate, ModelCardPatch, Metric, Source, Dataset, MetricCreate, SourceCreate, DatasetCreate, DatasetPatch, ModelSystemResponse, AISystemFormData, PermissionsResponse, WorkflowStep, UserSummary, ChatMessage, AssistTurnResponse, AssistExtractResponse, ClassificationResult, QuestionAssignment } from "../types";import type { SectionKey } from "../config/questionnaire";

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
  // ── System ↔ Model links (dead code, rework deferred) ────────────────────
  // ponytail: these endpoints exist but no UI calls them yet; rework together
  // with the System↔Model link UI pass.
  getSystemModels: (systemId: string) =>
    request<Array<ModelCard & { role: string | null }>>(`/systems/${systemId}/models`),
  addSystemModel: (systemId: string, modelCardId: string, role?: string) =>
    request<ModelCard & { role: string | null }>(`/systems/${systemId}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_card_id: modelCardId, role }),
    }),
  removeSystemModel: (systemId: string, modelCardId: string) =>
    request<null>(`/systems/${systemId}/models/${modelCardId}`, { method: "DELETE" }),

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

  // ── Model Cards ────────────────────────────────────────────────────────────
  getModels: () => request<ModelCard[]>("/model-cards?limit=200"),
  getModelCard: (id: string) => request<ModelCard>(`/model-cards/${id}`),
  createModelCard: (data: ModelCardCreate) =>
    request<ModelCard>("/model-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  patchModelCard: (id: string, data: ModelCardPatch) =>
    request<ModelCard>(`/model-cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteModelCard: (id: string) => request<null>(`/model-cards/${id}`, { method: "DELETE" }),

  addMetric: (cardId: string, data: MetricCreate) =>
    request<Metric>(`/model-cards/${cardId}/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteMetric: (cardId: string, metricId: string) =>
    request<null>(`/model-cards/${cardId}/metrics/${metricId}`, { method: "DELETE" }),

  addSource: (cardId: string, data: SourceCreate) =>
    request<Source>(`/model-cards/${cardId}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteSource: (cardId: string, sourceId: string) =>
    request<null>(`/model-cards/${cardId}/sources/${sourceId}`, { method: "DELETE" }),

  addDataset: (cardId: string, data: DatasetCreate) =>
    request<Dataset>(`/model-cards/${cardId}/datasets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  patchDataset: (cardId: string, dsId: string, data: DatasetPatch) =>
    request<Dataset>(`/model-cards/${cardId}/datasets/${dsId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  replaceDataset: (cardId: string, dsId: string, data: DatasetCreate) =>
    request<ModelCard>(`/model-cards/${cardId}/datasets/${dsId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteDataset: (cardId: string, dsId: string) =>
    request<null>(`/model-cards/${cardId}/datasets/${dsId}`, { method: "DELETE" }),

  getModelSystems: (modelId: string) => request<ModelSystemResponse[]>(`/model-cards/${modelId}/systems`),

  myPermissions: () => request<PermissionsResponse>("/me/permissions", {}, USERS_API_BASE),

  getUsersByRole: (role: string) =>
    request<UserSummary[]>(`/users/by-role?role=${encodeURIComponent(role)}`, {}, USERS_API_BASE),

  getAllUsers: async (): Promise<Array<{ username: string; firstName: string; lastName: string; role: string }>> => {
    const ROLES = [
      "platform_administrator", "ai_engineer", "ai_compliance_officer",
      "business_owner", "auditor", "executive",
    ];
    const lists = await Promise.all(
      ROLES.map((role) =>
        request<Array<{ username: string; firstName: string; lastName: string }>>(
          `/users/by-role?role=${encodeURIComponent(role)}`,
          {},
          USERS_API_BASE,
        )
          .then((users) => users.map((u) => ({ ...u, role })))
          .catch(() => [] as Array<{ username: string; firstName: string; lastName: string; role: string }>),
      ),
    );
    const seen = new Set<string>();
    return lists.flat().filter((u) => {
      if (seen.has(u.username)) return false;
      seen.add(u.username);
      return true;
    });
  },

  getWorkflow: (systemId: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow`),

  submitForReview: (systemId: string, assigneeUsername: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignee_username: assigneeUsername, note: note ?? null }),
    }),

  approveSystem: (systemId: string, note?: string, tier?: string, orgRole?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note ?? null, tier: tier ?? null, org_role: orgRole ?? null }),
    }),

  rejectSystem: (systemId: string, note: string, assigneeUsername: string, sendTo: "business" | "technical" = "business") =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, assignee_username: assigneeUsername, send_to: sendTo }),
    }),

  // New questionnaire workflow endpoints.
  assignWorkflow: (systemId: string, body: { business_assignee_username: string; technical_assignee_username?: string; compliance_officer_username: string; note?: string }) =>
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

  getRceSummary: (systemId: string) =>
    request<{
      tier: string | null;
      org_role: string | null;
      registration_mode: string | null;
      classification_rationale: unknown;
      obligations: Array<{ title: string; article_ref: string; description: string }>;
    }>(`/systems/${encodeURIComponent(systemId)}/workflow/rce-summary`),

  getQuestionAssignments: (systemId: string) =>
    request<QuestionAssignment[]>(`/systems/${encodeURIComponent(systemId)}/workflow/question-assignments`),

  questionAssign: (systemId: string, body: { section: string; question_key: string; assignee_username: string; note?: string }) =>
    request<QuestionAssignment[]>(`/systems/${encodeURIComponent(systemId)}/workflow/question-assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  questionUnassign: (systemId: string, body: { section: string; question_key: string }) =>
    request<QuestionAssignment[]>(`/systems/${encodeURIComponent(systemId)}/workflow/question-assign`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  questionAnswer: (systemId: string, body: { section: string; question_key: string }) =>
    request<QuestionAssignment[]>(`/systems/${encodeURIComponent(systemId)}/workflow/question-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};

