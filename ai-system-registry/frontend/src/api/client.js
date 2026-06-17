const API_BASE = import.meta.env.VITE_API_BASE;
export const HEALTH_URL = API_BASE.replace("/api/v1", "") + "/health";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  getSystems: () => request("/systems"),
  getSystem: (id) => request(`/systems/${id}`),
  deleteSystem: (id) => request(`/systems/${id}`, { method: "DELETE" }),
  updateSystem: (id, data) =>
    request(`/systems/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  intake: (data) =>
    request("/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  linkModel: (systemId, modelId) =>
    request(`/systems/${systemId}/model?model_id=${encodeURIComponent(modelId)}`, { method: "PUT" }),
  unlinkModel: (systemId) =>
    request(`/systems/${systemId}/model`, { method: "DELETE" }),

  getModels: () => request("/model-cards?limit=200"),
  createModel: (data) =>
    request("/model-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateModel: (id, data) =>
    request(`/model-cards/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteModel: (id) => request(`/model-cards/${id}`, { method: "DELETE" }),
};
