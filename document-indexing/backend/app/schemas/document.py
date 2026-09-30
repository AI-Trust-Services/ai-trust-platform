from __future__ import annotations

from datetime import datetime
from typing import Any

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
    chunk_count: int
    error: str | None = None
    created_at: datetime
    indexed_at: datetime | None = None


class RetrieveRequest(BaseModel):
    ai_system_id: str
    query: str = Field(..., min_length=1)
    k: int = Field(default=10, ge=1, le=50)


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
    score: float
    source: SourceRef
