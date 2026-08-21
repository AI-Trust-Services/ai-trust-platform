from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class DemoSummary(BaseModel):
    id: str
    name: str
    description: str
    annex_iii_point: str
    annex_iii_category: str


class DemoListResponse(BaseModel):
    demos: list[DemoSummary]


class DemoSystemResponse(DemoSummary):
    system_description: str
    metadata: dict[str, Any]
