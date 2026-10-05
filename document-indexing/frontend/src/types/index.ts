export interface PermissionsResponse {
  username: string;
  permissions: string[];
}

export type IndexingStatus = "pending" | "processing" | "indexed" | "failed";

export interface AISystem {
  id: string;
  name: string;
  lifecycle: string | null;
}

export interface DocumentStatus {
  id: string;
  ai_system_id: string;
  filename: string;
  mime_type: string | null;
  version_id: string;
  version_label: string;
  status: IndexingStatus;
  stage: string | null;
  chunk_count: number;
  error: string | null;
  created_at: string;
  indexed_at: string | null;
}

export interface VersionInfo {
  id: string;
  version_label: string;
  status: IndexingStatus;
  chunk_count: number;
  is_current: boolean;
  error: string | null;
  created_at: string;
  indexed_at: string | null;
}

export interface UploadResponse {
  document_id: string;
  version_id: string;
  status: IndexingStatus;
}

export interface DownloadUrlResponse {
  url: string;
  expires_hours: number;
}

export interface SourceRef {
  document_id: string;
  version_id: string;
  version_label: string;
  filename: string;
  chunk_index: number;
  page: number | null;
  bbox: unknown | null;
  self_ref: string | null;
  heading_path: string[] | null;
}

export interface RetrievedPassage {
  chunk_id: string;
  passage: string;
  rank: number;
  source: SourceRef;
}
