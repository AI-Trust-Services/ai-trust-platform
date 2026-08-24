import type { AISystem, ModelCard, AISystemFormData, ModelCardFormData, PermissionsResponse, SystemModelResponse, ModelSystemResponse, WorkflowStep, UserSummary } from "../types";

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
  getSystemModels: (systemId: string) =>
    request<SystemModelResponse[]>(`/systems/${systemId}/models`),
  addSystemModel: (systemId: string, modelCardId: string, role?: string) =>
    request<SystemModelResponse>(`/systems/${systemId}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_card_id: modelCardId, role }),
    }),
  removeSystemModel: (systemId: string, modelCardId: string) =>
    request<null>(`/systems/${systemId}/models/${modelCardId}`, { method: "DELETE" }),

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
  getModelSystems: (modelId: string) => request<ModelSystemResponse[]>(`/model-cards/${modelId}/systems`),

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
};
