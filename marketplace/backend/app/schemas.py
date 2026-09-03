from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

_NAME_RE = re.compile(r"^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$")  # RFC-1123 label, must serve k8s names


class ServiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=63, description="k8s-safe slug, e.g. 'weather'")
    label: str = Field(..., min_length=1, max_length=200)
    git_url: str = Field(..., min_length=1)
    git_ref: str = Field(default="main", max_length=200)
    source: str = Field(default="internal")  # internal | external
    open_mode: str = Field(default="same_window")  # same_window | new_tab
    # For source="external", the URL the tile opens (no deploy happens).
    external_url: str | None = None

    @field_validator("name")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("name must be a lowercase RFC-1123 label (a-z, 0-9, '-')")
        return v

    @field_validator("source")
    @classmethod
    def _valid_source(cls, v: str) -> str:
        if v not in ("internal", "external"):
            raise ValueError("source must be 'internal' or 'external'")
        return v

    @field_validator("open_mode")
    @classmethod
    def _valid_open_mode(cls, v: str) -> str:
        if v not in ("same_window", "new_tab"):
            raise ValueError("open_mode must be 'same_window' or 'new_tab'")
        return v


class ServiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    label: str
    git_url: str
    git_ref: str
    kind: str
    source: str
    open_mode: str
    status: str
    service_host: str | None
    error: str | None
    created_at: datetime
    updated_at: datetime
