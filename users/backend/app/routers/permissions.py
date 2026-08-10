"""GET /me/permissions — returns the current user's effective permissions."""
from fastapi import APIRouter, Depends

from ai_trust_authorization import get_current_user, openfga_client
from ai_trust_authorization.constants import (
    ALL_PERMISSIONS,
    PLATFORM_OBJECT,
    RELATION_BY_PERMISSION,
)
from app.schemas import PermissionsResponse

router = APIRouter(tags=["permissions"])


@router.get("/me/permissions", response_model=PermissionsResponse)
async def my_permissions(
    user: str = Depends(get_current_user),
) -> PermissionsResponse:
    relations = [RELATION_BY_PERMISSION[p] for p in ALL_PERMISSIONS]
    allowed_relations = await openfga_client.list_allowed_relations(
        f"user:{user}", relations, PLATFORM_OBJECT
    )
    allowed = set(allowed_relations)
    permissions = [p for p in ALL_PERMISSIONS if RELATION_BY_PERMISSION[p] in allowed]
    return PermissionsResponse(username=user, permissions=permissions)
