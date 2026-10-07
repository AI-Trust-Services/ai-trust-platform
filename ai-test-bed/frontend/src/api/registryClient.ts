import type { AISystem } from "../types";

// AI-system list for the selector — read from the registry backend (same source the
// compliance MFE uses). The env var is already loaded via the repo-root envDir.
const API_BASE = import.meta.env.VITE_REGISTRY_API_BASE;

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string })?.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const registryApi = {
  getSystems: () => request<AISystem[]>("/systems?limit=200"),
};
