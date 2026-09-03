export interface MarketplaceService {
  id: string;
  name: string;
  label: string;
  git_url: string;
  git_ref: string;
  kind: string;
  source: "internal" | "external";
  open_mode: "same_window" | "new_tab";
  status: "pending" | "deploying" | "running" | "failed";
  service_host: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceCreate {
  name: string;
  label: string;
  git_url: string;
  git_ref?: string;
  source?: "internal" | "external";
  open_mode?: "same_window" | "new_tab";
  external_url?: string;
}

// Same-origin through the shell: /api/marketplace/ -> marketplace-backend. Overridable at build.
const API_BASE =
  (import.meta.env.VITE_MARKETPLACE_API_BASE as string | undefined) || "/api/marketplace/v1";

function formatDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(e.loc) ? String(e.loc[e.loc.length - 1]) : "";
        return field ? `${field}: ${e.msg ?? ""}` : e.msg ?? "";
      })
      .join("; ");
  }
  return String(detail);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(formatDetail(err.detail) || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as unknown as T) : (res.json() as Promise<T>);
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  list: (): Promise<MarketplaceService[]> => request<MarketplaceService[]>("/services"),
  add: (data: ServiceCreate): Promise<MarketplaceService> =>
    request<MarketplaceService>("/services", json("POST", data)),
  deploy: (id: string): Promise<MarketplaceService> =>
    request<MarketplaceService>(`/services/${id}/deploy`, { method: "POST" }),
  status: (id: string): Promise<MarketplaceService> =>
    request<MarketplaceService>(`/services/${id}/status`),
  remove: (id: string): Promise<{ status: string }> =>
    request<{ status: string }>(`/services/${id}`, { method: "DELETE" }),
};

// The same-origin path an embedded internal service is proxied at.
export const proxyBase = (name: string): string => `${API_BASE}/proxy/${name}/`;
