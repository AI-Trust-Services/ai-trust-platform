from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

# Internal host only — no /api prefix; nginx adds that externally via ROOT_PATH
_REGISTRY_BASE = os.environ.get("REGISTRY_INTERNAL_BASE", "http://ai-system-registry-backend:8001")


class RegistrySystemInfo(BaseModel):
    name: str
    description: str
    intended_purpose: str
    department: str | None
    use_case: str | None
    people_affected: str | None
    decision_context: str | None
    autonomy_level: str | None
    tier: str
    lifecycle: str
    org_role: str
    provider: str | None
    org_name: str | None
    version: str | None


@router.get("/systems/{system_id}/registry-info", response_model=RegistrySystemInfo)
async def get_registry_info(system_id: str, request: Request) -> RegistrySystemInfo:
    url = f"{_REGISTRY_BASE}/v1/systems/{system_id}"
    headers: dict[str, str] = {}
    username = request.headers.get("x-forwarded-preferred-username", "")
    if username:
        headers["x-forwarded-preferred-username"] = username
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="System not found in registry")
    if not resp.is_success:
        raise HTTPException(status_code=502, detail="Registry unavailable")
    data = resp.json()
    return RegistrySystemInfo(
        name=data.get("name", ""),
        description=data.get("description", ""),
        intended_purpose=data.get("intended_purpose", ""),
        department=data.get("department"),
        use_case=data.get("use_case"),
        people_affected=data.get("people_affected"),
        decision_context=data.get("decision_context"),
        autonomy_level=data.get("autonomy_level"),
        tier=data.get("tier", ""),
        lifecycle=data.get("lifecycle", ""),
        org_role=data.get("org_role", ""),
        provider=data.get("provider"),
        org_name=data.get("org_name"),
        version=data.get("version"),
    )
