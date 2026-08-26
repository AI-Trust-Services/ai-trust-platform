"""Pydantic v2 schemas for Evidence.

Note: evidence creation uses a multipart form (file upload), so the router
parses fields via FastAPI Form(...) rather than a JSON body model. These schemas
cover the response shape and the metadata-only update path.
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

VALID_EVIDENCE_TYPES = frozenset({
    "document", "policy_document", "technical_doc", "test_report",
    "monitoring_data", "approval_record", "audit_log", "training_record",
    "certificate", "screenshot", "api_log",
})
VALID_EVIDENCE_STATUSES = frozenset({
    "pending", "under_review", "approved", "rejected", "expired",
})


class EvidenceUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    evidence_type: str | None = None
    status: str | None = None
    validity_from: date | None = None
    validity_until: date | None = None

    @field_validator("evidence_type")
    @classmethod
    def type_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_EVIDENCE_TYPES:
            raise ValueError(f"invalid evidence type '{v}'")
        return v

    @field_validator("status")
    @classmethod
    def status_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_EVIDENCE_STATUSES:
            raise ValueError(f"invalid evidence status '{v}'")
        return v


class EvidenceResponse(BaseModel):
    id: str
    ai_system_ids: list[str] = []
    assessment_ids: list[str] = []
    title: str
    description: str
    evidence_type: str
    status: str
    validity_from: date | None
    validity_until: date | None
    file_name: str
    file_size: int
    mime_type: str
    uploaded_by: str
    version_label: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EvidenceDetailResponse(EvidenceResponse):
    control_ids: list[str] = []
    obligation_ids: list[str] = []


class EvidenceVersionResponse(BaseModel):
    id: str
    evidence_id: str
    version_label: str
    file_name: str
    file_size: int
    mime_type: str
    uploaded_by: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DownloadUrlResponse(BaseModel):
    url: str
    expires_hours: int
