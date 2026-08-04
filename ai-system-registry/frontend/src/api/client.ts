import type { AISystem, ModelCard, AISystemFormData, ModelCardFormData, PermissionsResponse } from "../types";

const API_BASE = import.meta.env.VITE_REGISTRY_API_BASE;
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
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

  // Current user's effective permissions — used to grey out actions the user cannot perform.
  myPermissions: () => request<PermissionsResponse>("/me/permissions"),
};
