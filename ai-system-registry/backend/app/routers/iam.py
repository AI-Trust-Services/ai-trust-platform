"""IAM (role management) API.

Endpoints (all require iam:manage except /me/permissions):
  GET    /iam/roles                 — built-in roles + their permissions
  GET    /iam/users                 — realm users (from Keycloak) + assigned role
  PUT    /iam/users/{username}/role — assign a role (replaces any existing role)
  DELETE /iam/users/{username}/role — remove the user's role
  GET    /me/permissions            — current user's effective permissions

Role assignments live entirely in OpenFGA as `user:<name> member role:<role>`
tuples. Phase 2 restricts a user to a single role: assigning a new role first
removes any existing role membership.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ai_trust_authorization import get_current_user, openfga_client, require_permission
from ai_trust_authorization.constants import (
    ALL_PERMISSIONS,
    BUILT_IN_ROLES,
    ROLE_PERMISSIONS,
)
from ai_trust_logging import get_logger
from app import keycloak_admin
from app.schemas.iam import (
    AssignRoleRequest,
    PermissionsResponse,
    RoleInfo,
    UserRole,
)

router = APIRouter(tags=["iam"])
logger = get_logger(__name__)


def _role_object(role: str) -> str:
    return f"role:{role}"


def _role_from_object(role_object: str) -> str:
    # "role:auditor" -> "auditor"
    return role_object.split(":", 1)[1] if ":" in role_object else role_object


@router.get("/iam/roles", response_model=list[RoleInfo])
async def list_roles(
    _: str = Depends(require_permission("iam:manage")),
) -> list[RoleInfo]:
    return [RoleInfo(name=r, permissions=ROLE_PERMISSIONS[r]) for r in BUILT_IN_ROLES]


@router.get("/iam/users", response_model=list[UserRole])
async def list_users(
    _: str = Depends(require_permission("iam:manage")),
) -> list[UserRole]:
    users = await keycloak_admin.list_users()
    result: list[UserRole] = []
    for u in users:
        roles = await openfga_client.read_user_roles(f"user:{u['username']}")
        # Phase 2: single role per user. Take the first if multiple exist.
        role = _role_from_object(roles[0]) if roles else None
        result.append(UserRole(role=role, **u))
    return result


@router.put("/iam/users/{username}/role", response_model=UserRole)
async def assign_role(
    username: str,
    body: AssignRoleRequest,
    _: str = Depends(require_permission("iam:manage")),
) -> UserRole:
    if body.role not in BUILT_IN_ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown role: {body.role}")

    user = f"user:{username}"
    # Remove any existing role memberships first (single-role invariant).
    existing = await openfga_client.read_user_roles(user)
    for role_object in existing:
        await openfga_client.delete_tuple(user, "member", role_object)

    await openfga_client.write_tuple(user, "member", _role_object(body.role))
    logger.info("iam.role_assigned", extra={"username": username, "role": body.role})
    return UserRole(username=username, role=body.role)


@router.delete("/iam/users/{username}/role")
async def remove_role(
    username: str,
    _: str = Depends(require_permission("iam:manage")),
) -> dict:
    user = f"user:{username}"
    existing = await openfga_client.read_user_roles(user)
    for role_object in existing:
        await openfga_client.delete_tuple(user, "member", role_object)
    logger.info("iam.role_removed", extra={"username": username})
    return {"status": "removed", "username": username}


@router.get("/me/permissions", response_model=PermissionsResponse)
async def my_permissions(
    user: str = Depends(get_current_user),
) -> PermissionsResponse:
    from ai_trust_authorization.constants import PLATFORM_OBJECT, RELATION_BY_PERMISSION

    # Batch-check every known permission against platform:global.
    relations = [RELATION_BY_PERMISSION[p] for p in ALL_PERMISSIONS]
    allowed_relations = await openfga_client.list_allowed_relations(
        f"user:{user}", relations, PLATFORM_OBJECT
    )
    allowed = set(allowed_relations)
    permissions = [
        p for p in ALL_PERMISSIONS if RELATION_BY_PERMISSION[p] in allowed
    ]
    return PermissionsResponse(username=user, permissions=permissions)
