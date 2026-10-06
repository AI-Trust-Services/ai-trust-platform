from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    document_id: str
    version_id: str
    status: str


class DocumentStatusResponse(BaseModel):
    """Per-document indexing status (acceptance criterion 1)."""

    id: str
    ai_system_id: str
    filename: str
    mime_type: str | None = None
    version_id: str
    version_label: str
    status: str
    # Fine-grained phase within `processing` (parsing | embedding | storing); null
    # outside that state. Drives the UI progress indicator.
    stage: str | None = None
    chunk_count: int
    error: str | None = None
    created_at: datetime
    indexed_at: datetime | None = None


class VersionResponse(BaseModel):
    """One entry in a document's version history (oldest-first)."""

    model_config = {"from_attributes": True}

    id: str
    version_label: str
    status: str
    chunk_count: int
    is_current: bool
    error: str | None = None
    created_at: datetime
    indexed_at: datetime | None = None


class DownloadUrlResponse(BaseModel):
    url: str
    expires_hours: int


class RetrieveRequest(BaseModel):
    ai_system_id: str
    query: str = Field(..., min_length=1)
    k: int = Field(default=10, ge=1, le=50)
    mode: Literal["dense", "fts", "hybrid"] = "hybrid"
    rrf_k: int = Field(default=60, ge=1, le=200)


class SourceRef(BaseModel):
    document_id: str
    version_id: str
    version_label: str
    filename: str
    chunk_index: int
    page: int | None = None
    bbox: Any | None = None
    self_ref: str | None = None
    heading_path: Any | None = None


class RetrievedPassage(BaseModel):
    chunk_id: str
    passage: str
    # 1-based position in the fused ranking (ordering only, not a relevance score).
    rank: int
    # Per-channel diagnostics (Test Bed advanced panel); None when the chunk did not
    # surface in that channel. rrf_score is set only in hybrid mode.
    dense_rank: int | None = None
    dense_score: float | None = None
    fts_rank: int | None = None
    fts_score: float | None = None
    rrf_score: float | None = None
    source: SourceRef
