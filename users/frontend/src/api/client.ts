import type {
  InviteUserRequest,
  RoleInfo,
  RoleSummary,
  UpdateUserRequest,
  UserDetail,
  UsersListResponse,
} from "../types";

const API_BASE = import.meta.env.VITE_USERS_API_BASE as string;
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";

function formatDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(e.loc) ? String(e.loc[e.loc.length - 1]) : "";
        return field ? `${field}: ${e.msg ?? ""}` : (e.msg ?? "");
      })
      .join("; ");
  }
  return String(detail);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: unknown };
    throw new Error(formatDetail(err.detail) || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as unknown as T) : (res.json() as Promise<T>);
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

type QueryParams = Record<string, string | undefined>;
function qs(params: QueryParams): string {
  const p = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))
  ).toString();
  return p ? `?${p}` : "";
}

export const api = {
  getUsers: (params: QueryParams = {}): Promise<UsersListResponse> =>
    request<UsersListResponse>(`/users${qs(params)}`),

  getUser: (id: string): Promise<UserDetail> =>
    request<UserDetail>(`/users/${id}`),

  inviteUser: (data: InviteUserRequest): Promise<UserDetail> =>
    request<UserDetail>("/users", json("POST", data)),

  updateUser: (id: string, data: UpdateUserRequest): Promise<UserDetail> =>
    request<UserDetail>(`/users/${id}`, json("PUT", data)),

  activateUser: (id: string): Promise<UserDetail> =>
    request<UserDetail>(`/users/${id}/activate`, { method: "POST" }),

  deactivateUser: (id: string): Promise<UserDetail> =>
    request<UserDetail>(`/users/${id}/deactivate`, { method: "POST" }),

  deleteUser: (id: string): Promise<null> =>
    request<null>(`/users/${id}`, { method: "DELETE" }),

  assignRole: (userId: string, roleName: string): Promise<UserDetail> =>
    request<UserDetail>(`/users/${userId}/roles/${roleName}`, { method: "POST" }),

  removeRole: (userId: string, roleName: string): Promise<UserDetail> =>
    request<UserDetail>(`/users/${userId}/roles/${roleName}`, { method: "DELETE" }),

  getRoles: (): Promise<RoleSummary[]> =>
    request<RoleSummary[]>("/roles"),

  getRoleDetails: (): Promise<RoleInfo[]> =>
    request<RoleInfo[]>("/iam/roles"),

  myPermissions: () =>
    request<{ permissions: string[] }>("/me/permissions"),
};
