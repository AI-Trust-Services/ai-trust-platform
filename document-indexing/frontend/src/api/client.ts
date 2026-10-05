import type {
  DocumentStatus,
  PermissionsResponse,
  RetrievedPassage,
  UploadResponse,
} from "../types";

const API_BASE = import.meta.env.VITE_INDEXING_API_BASE as string;
const USERS_API_BASE = import.meta.env.VITE_USERS_API_BASE as string;

export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";

/** Normalise a FastAPI error body (string detail, or a validation-error array) into one message. */
function formatDetail(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const loc = Array.isArray(e?.loc) ? e.loc.filter((p: unknown) => p !== "body").join(".") : "";
        return loc ? `${loc}: ${e?.msg ?? ""}` : e?.msg ?? "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return `HTTP ${status}`;
}

async function requestBase<T>(base: string, path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(formatDetail(body, res.status));
  }
  // 200 with empty body (e.g. some deletes) → tolerate.
  return res.json().catch(() => ({} as T));
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestBase<T>(API_BASE, path, options);
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  myPermissions: () => requestBase<PermissionsResponse>(USERS_API_BASE, "/me/permissions"),

  listDocuments: (systemId: string) =>
    request<DocumentStatus[]>(`/systems/${encodeURIComponent(systemId)}/documents`),

  getDocument: (documentId: string) =>
    request<DocumentStatus>(`/documents/${encodeURIComponent(documentId)}`),

  uploadDocument: (systemId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<UploadResponse>(`/systems/${encodeURIComponent(systemId)}/documents`, {
      method: "POST",
      body: form,
    });
  },

  deleteDocument: (documentId: string) =>
    request<{ deleted: boolean }>(`/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    }),

  retrieve: (aiSystemId: string, query: string, k: number) =>
    request<RetrievedPassage[]>(`/retrieve`, json({ ai_system_id: aiSystemId, query, k })),
};
