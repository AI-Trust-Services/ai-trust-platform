export interface ServiceInfo {
  service_name: string;
  system_id: string;
  display_name: string;
  total_spans: number;
  last_seen: string;
}

export interface TimeseriesPoint {
  time: string;
  inference_count: number;
  avg_latency_ms: number | null;
  input_tokens: number;
  output_tokens: number;
}

export interface Kpis {
  total_inferences: number;
  avg_latency_ms: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface SignalsData {
  kpis: Kpis;
  timeseries: TimeseriesPoint[];
  display_name: string;
}

const API_BASE = import.meta.env.VITE_MONITORING_API_BASE;
export const HEALTH_URL = API_BASE.replace("/api/v1", "") + "/health";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as T) : res.json();
}

export const api = {
  getServices: () => request<ServiceInfo[]>("/monitoring/services"),
  getSignals: (service: string, window: string) => {
    const params = new URLSearchParams({ window });
    if (service) params.append("service", service);
    return request<SignalsData>(`/monitoring/signals?${params}`);
  },
};
