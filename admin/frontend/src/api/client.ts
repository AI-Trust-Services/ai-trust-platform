/**
 * Admin API client for platform administration.
 */

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || "/api/users/v1/admin";
const USERS_API_BASE = import.meta.env.VITE_USERS_API_BASE || "/api/users/v1";

export const HEALTH_URL = `${USERS_API_BASE.replace("/v1", "")}/health`;

// --- Types ---

export interface SettingResponse {
  key: string;
  value: unknown;
  category: string;
  label: string;
  description: string;
  value_type: string;
  is_secret: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export interface SettingsGroup {
  category: string;
  label: string;
  settings: SettingResponse[];
}

export interface DashboardKPIs {
  user_count: number;
  role_count: number;
  ai_provider_count: number;
  mail_status: string;
}

export interface ConfigurationStatus {
  key: string;
  label: string;
  status: "healthy" | "warning" | "error" | "not_configured";
  message: string;
}

export interface DashboardResponse {
  kpis: DashboardKPIs;
  configuration_status: ConfigurationStatus[];
}

export interface AdminActivity {
  id: string;
  action: string;
  description: string;
  actor: string | null;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface ActivityResponse {
  activities: AdminActivity[];
}

export interface TestResponse {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

// --- Helpers ---

class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

// --- API Methods ---

export const api = {
  // Dashboard
  dashboard: {
    get: () => request<DashboardResponse>(`${API_BASE}/dashboard`),
    getActivity: () => request<ActivityResponse>(`${API_BASE}/dashboard/activity`),
  },

  // Settings
  settings: {
    list: () => request<SettingsGroup[]>(`${API_BASE}/settings`),
    get: (key: string) => request<SettingResponse>(`${API_BASE}/settings/${key}`),
    update: (key: string, value: unknown) =>
      request<SettingResponse>(`${API_BASE}/settings/${key}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      }),
    bulkUpdate: (settings: Record<string, unknown>) =>
      request<SettingResponse[]>(`${API_BASE}/settings/bulk`, {
        method: "POST",
        body: JSON.stringify({ settings }),
      }),
    testSmtp: (recipientEmail: string) =>
      request<TestResponse>(`${API_BASE}/settings/test-smtp`, {
        method: "POST",
        body: JSON.stringify({ recipient_email: recipientEmail }),
      }),
    testLlm: (prompt?: string) =>
      request<TestResponse>(`${API_BASE}/settings/test-llm`, {
        method: "POST",
        body: JSON.stringify({ prompt: prompt || "Hello, this is a test." }),
      }),
  },

  // Current user (from users API)
  me: {
    get: () => request<{ username: string; email: string; roles: string[] }>(`${USERS_API_BASE}/me`),
    permissions: () => request<{ permissions: string[] }>(`${USERS_API_BASE}/me/permissions`),
  },
};

export { ApiError };
