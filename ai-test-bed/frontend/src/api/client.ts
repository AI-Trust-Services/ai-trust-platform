import type {
  DocumentStatus,
  DownloadUrlResponse,
  PermissionsResponse,
  RetrieveMode,
  RetrievedPassage,
  TestBedEnabledSources,
  TestBedRole,
  TestBedRunResult,
  TestBedRunSummary,
  TestBedSample,
  TestBedSampleDetail,
  UploadResponse,
  VersionInfo,
} from "../types";

// Test Bed backend (ai-test-bed-backend)
const TESTBED_API_BASE = import.meta.env.VITE_TESTBED_API_BASE as string;
// Document Indexing backend (document-indexing-backend) — for document management
const INDEXING_API_BASE = import.meta.env.VITE_INDEXING_API_BASE as string;
const USERS_API_BASE = import.meta.env.VITE_USERS_API_BASE as string;

export const HEALTH_URL = TESTBED_API_BASE.replace("/v1", "") + "/health";

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
  return res.json().catch(() => ({} as T));
}

/** Calls the AI Test Bed backend. */
function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestBase<T>(TESTBED_API_BASE, path, options);
}

/** Calls the Document Indexing backend. */
function indexingRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestBase<T>(INDEXING_API_BASE, path, options);
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

  // ---- Document Indexing (document-indexing-backend) ----
  listDocuments: (systemId: string) =>
    indexingRequest<DocumentStatus[]>(`/systems/${encodeURIComponent(systemId)}/documents`),

  getDocument: (documentId: string) =>
    indexingRequest<DocumentStatus>(`/documents/${encodeURIComponent(documentId)}`),

  uploadDocument: (systemId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return indexingRequest<UploadResponse>(`/systems/${encodeURIComponent(systemId)}/documents`, {
      method: "POST",
      body: form,
    });
  },

  uploadVersion: (documentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return indexingRequest<UploadResponse>(`/documents/${encodeURIComponent(documentId)}/versions`, {
      method: "POST",
      body: form,
    });
  },

  listVersions: (documentId: string) =>
    indexingRequest<VersionInfo[]>(`/documents/${encodeURIComponent(documentId)}/versions`),

  getDownloadUrl: (documentId: string, versionId?: string) =>
    indexingRequest<DownloadUrlResponse>(
      `/documents/${encodeURIComponent(documentId)}/download-url` +
        (versionId ? `?version_id=${encodeURIComponent(versionId)}` : ""),
    ),

  deleteDocument: (documentId: string) =>
    indexingRequest<{ deleted: boolean }>(`/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    }),

  retrieve: (
    aiSystemId: string,
    query: string,
    k: number,
    opts?: { mode?: RetrieveMode; rrfK?: number },
  ) =>
    indexingRequest<RetrievedPassage[]>(
      `/retrieve`,
      json({ ai_system_id: aiSystemId, query, k, mode: opts?.mode, rrf_k: opts?.rrfK }),
    ),

  // ---- AI Test Bed (ai-test-bed-backend) ----
  listTestBedSamples: () => request<TestBedSample[]>("/testbed/samples"),

  getTestBedSample: (sampleId: string) =>
    request<TestBedSampleDetail>(`/testbed/samples/${encodeURIComponent(sampleId)}`),

  runTestBed: (body: {
    sample_id: string;
    role: TestBedRole;
    enabled_sources: TestBedEnabledSources;
    prompt_override?: string | null;
    model?: string | null;
    retrieval_k?: number;
    retrieval_mode?: RetrieveMode;
    retrieval_rrf_k?: number;
  }) => request<TestBedRunResult>("/testbed/run", json(body)),

  listTestBedRuns: (sampleId?: string) =>
    request<TestBedRunSummary[]>(
      `/testbed/runs${sampleId ? `?sample_id=${encodeURIComponent(sampleId)}` : ""}`,
    ),

  getTestBedRun: (runId: string) =>
    request<TestBedRunResult>(`/testbed/runs/${encodeURIComponent(runId)}`),
};
