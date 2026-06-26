const API_BASE = import.meta.env.VITE_MONITORING_API_BASE;
export const HEALTH_URL = API_BASE.replace("/api/v1", "") + "/health";

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  getServices: () => request("/monitoring/services"),
  getSignals: (service: string, window: string) => {
    const params = new URLSearchParams({ window });
    if (service) params.append("service", service);
    return request(`/monitoring/signals?${params}`);
  },
};
