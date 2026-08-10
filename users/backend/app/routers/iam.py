"""GET /iam/roles — built-in roles and the permissions each grants (requires iam:manage)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import BUILT_IN_ROLES, ROLE_PERMISSIONS

router = APIRouter(prefix="/iam", tags=["iam"])


class RoleInfo(BaseModel):
    name: str
    permissions: list[str]


@router.get("/roles", response_model=list[RoleInfo])
async def list_roles(
    _: str = Depends(require_permission("iam:manage")),
) -> list[RoleInfo]:
    return [RoleInfo(name=r, permissions=ROLE_PERMISSIONS[r]) for r in BUILT_IN_ROLES]
