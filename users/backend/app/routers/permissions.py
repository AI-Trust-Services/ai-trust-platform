"""GET /me/permissions and GET /me — current user endpoints."""
from fastapi import APIRouter, Depends

from ai_trust_authorization import get_current_user, openfga_client
from ai_trust_authorization.constants import (
    ALL_PERMISSIONS,
    PLATFORM_OBJECT,
    RELATION_BY_PERMISSION,
)
from app.keycloak import admin_client, current_realm
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


@router.get("/me")
async def me(user: str = Depends(get_current_user)) -> dict:
    import asyncio
    # Resolve the realm HERE (on the event loop), where the request's tenant ContextVar is set.
    # current_realm() reads that ContextVar; ContextVars do NOT propagate into the asyncio.to_thread
    # worker below, so resolving it inside _fetch would fail-closed ("No tenant in request context").
    realm = current_realm()
    def _fetch():
        kc = admin_client(realm)
        results = kc.get(f"users?username={user}&exact=true").json()
        return results[0] if results else {}
    u, role_objects = await asyncio.gather(
        asyncio.to_thread(_fetch),
        openfga_client.read_user_roles(f"user:{user}"),
    )
    roles = [r.removeprefix("role:") for r in role_objects]
    return {
        "username": user,
        "firstName": u.get("firstName", ""),
        "lastName": u.get("lastName", ""),
        "email": u.get("email", ""),
        "roles": roles,
    }
