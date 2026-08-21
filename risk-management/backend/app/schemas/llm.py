from __future__ import annotations

from pydantic import BaseModel


class LLMStatusResponse(BaseModel):
    available: bool
    model: str
    base_url: str
