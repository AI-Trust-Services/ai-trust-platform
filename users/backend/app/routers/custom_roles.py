"""Custom role management API.

Endpoints (all require iam:manage):
  GET    /iam/custom-roles              — list all custom roles with permissions
  POST   /iam/custom-roles              — create a custom role
  PUT    /iam/custom-roles/{role_id}    — update description and/or permissions
  DELETE /iam/custom-roles/{role_id}    — delete role + strip from all users
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from ai_trust_authorization import openfga_client, require_permission
from ai_trust_authorization.constants import ALL_PERMISSIONS, PLATFORM_OBJECT, RELATION_BY_PERMISSION
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.custom_role import CustomRole
from app.keycloak import admin_client

router = APIRouter(prefix="/iam", tags=["custom-roles"])
logger = get_logger(__name__)


class CustomRoleCreate(BaseModel):
    name: str
    description: str = ""
    permissions: list[str]


class CustomRoleUpdate(BaseModel):
    description: str | None = None
    permissions: list[str] | None = None


class CustomRoleResponse(BaseModel):
    id: str
    name: str
    description: str
    permissions: list[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}


def _role_object(name: str) -> str:
    return f"role:{name.lower().replace(' ', '_')}"


def _validate_permissions(permissions: list[str]) -> None:
    unknown = [p for p in permissions if p not in ALL_PERMISSIONS]
    if unknown:
        raise HTTPException(400, f"Unknown permissions: {unknown}")


async def _get_role_permissions(role_name: str) -> list[str]:
    """Read current permission tuples for a role from OpenFGA."""
    from openfga_sdk.models.read_request_tuple_key import ReadRequestTupleKey
    target_user = f"{_role_object(role_name)}#member"
    async with openfga_client.get_client() as client:
        body = ReadRequestTupleKey(object=PLATFORM_OBJECT)
        response = await client.read(body)
        tuples = response.tuples or []
    relation_to_perm = {v: k for k, v in RELATION_BY_PERMISSION.items()}
    return [
        relation_to_perm[t.key.relation]
        for t in tuples
        if t.key.user == target_user and t.key.relation in relation_to_perm
    ]


async def _set_role_permissions(role_name: str, permissions: list[str]) -> None:
    """Replace all permission tuples for a role."""
    existing = await _get_role_permissions(role_name)
    to_remove = set(existing) - set(permissions)
    to_add = set(permissions) - set(existing)
    role_user = f"{_role_object(role_name)}#member"
    for p in to_remove:
        await openfga_client.delete_tuple(
            role_user, RELATION_BY_PERMISSION[p], PLATFORM_OBJECT
        )
    for p in to_add:
        await openfga_client.write_tuple(
            role_user, RELATION_BY_PERMISSION[p], PLATFORM_OBJECT
        )


def _ensure_keycloak_role(name: str) -> None:
    with admin_client() as kc:
        resp = kc.get(f"/roles/{name}")
        if resp.status_code == 404:
            kc.post("/roles", json={"name": name}).raise_for_status()


def _delete_keycloak_role(name: str) -> None:
    with admin_client() as kc:
        resp = kc.get(f"/roles/{name}")
        if resp.status_code == 404:
            return
        role_id = resp.json()["id"]
        kc.delete(f"/roles-by-id/{role_id}").raise_for_status()

async def _delete_all_member_tuples(role_name: str) -> None:
    """Remove all user:* member tuples for this role from OpenFGA."""
    members = await openfga_client.read_role_members(_role_object(role_name))
    for user in members:
        await openfga_client.delete_tuple(user, "member", _role_object(role_name))


@router.get("/custom-roles", response_model=list[CustomRoleResponse])
async def list_custom_roles(
    _: str = Depends(require_permission("iam:manage")),
) -> list[CustomRoleResponse]:
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(CustomRole).order_by(CustomRole.created_at)
        )).scalars().all()

    # Fetch all platform:global tuples once and group by user to avoid N sequential reads.
    from openfga_sdk.models.read_request_tuple_key import ReadRequestTupleKey
    async with openfga_client.get_client() as client:
        response = await client.read(ReadRequestTupleKey(object=PLATFORM_OBJECT))
        all_tuples = response.tuples or []

    relation_to_perm = {v: k for k, v in RELATION_BY_PERMISSION.items()}
    perms_by_user: dict[str, list[str]] = {}
    for t in all_tuples:
        if t.key.relation in relation_to_perm:
            perms_by_user.setdefault(t.key.user, []).append(relation_to_perm[t.key.relation])

    result = []
    for row in rows:
        role_user = f"{_role_object(row.name)}#member"
        r = CustomRoleResponse.model_validate(row)
        r.permissions = perms_by_user.get(role_user, [])
        result.append(r)
    return result


@router.post("/custom-roles", response_model=CustomRoleResponse, status_code=201)
async def create_custom_role(
    body: CustomRoleCreate,
    _: str = Depends(require_permission("iam:manage")),
) -> CustomRoleResponse:
    if not body.name.strip():
        raise HTTPException(422, "name must not be blank")
    _validate_permissions(body.permissions)

    # 1. Postgres
    async with SessionLocal() as session:
        existing = (await session.execute(
            select(CustomRole).where(CustomRole.name == body.name)
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(409, f"Role '{body.name}' already exists")
        # new_id() lives in compliance/backend — not a shared lib, so uuid4 here is intentional
        row = CustomRole(
            id=f"ROLE-{uuid.uuid4().hex[:8].upper()}",
            name=body.name,
            description=body.description,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)

    # 2. OpenFGA permission tuples
    try:
        await _set_role_permissions(body.name, body.permissions)
    except Exception:
        async with SessionLocal() as session:
            r = (await session.execute(select(CustomRole).where(CustomRole.id == row.id))).scalar_one_or_none()
            if r:
                await session.delete(r)
                await session.commit()
        raise

    # 3. Keycloak realm role
    try:
        await asyncio.to_thread(_ensure_keycloak_role, body.name)
    except Exception:
        await _set_role_permissions(body.name, [])
        async with SessionLocal() as session:
            r = (await session.execute(select(CustomRole).where(CustomRole.id == row.id))).scalar_one_or_none()
            if r:
                await session.delete(r)
                await session.commit()
        raise

    logger.info("custom_role.created", extra={"role_id": row.id, "role_name": body.name})
    result = CustomRoleResponse.model_validate(row)
    result.permissions = body.permissions
    return result


@router.put("/custom-roles/{role_id}", response_model=CustomRoleResponse)
async def update_custom_role(
    role_id: str,
    body: CustomRoleUpdate,
    _: str = Depends(require_permission("iam:manage")),
) -> CustomRoleResponse:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(CustomRole).where(CustomRole.id == role_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Custom role {role_id} not found")

        if body.description is not None:
            row.description = body.description
        await session.commit()
        await session.refresh(row)

    if body.permissions is not None:
        _validate_permissions(body.permissions)
        await _set_role_permissions(row.name, body.permissions)

    permissions = await _get_role_permissions(row.name)
    logger.info("custom_role.updated", extra={"role_id": role_id, "role_name": row.name})
    result = CustomRoleResponse.model_validate(row)
    result.permissions = permissions
    return result


@router.delete("/custom-roles/{role_id}")
async def delete_custom_role(
    role_id: str,
    _: str = Depends(require_permission("iam:manage")),
) -> Response:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(CustomRole).where(CustomRole.id == role_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Custom role {role_id} not found")
        name = row.name

    # Safe deletion order: Keycloak → OpenFGA → Postgres
    await asyncio.to_thread(_delete_keycloak_role, name)
    await _delete_all_member_tuples(name)
    await _set_role_permissions(name, [])

    async with SessionLocal() as session:
        row = (await session.execute(
            select(CustomRole).where(CustomRole.id == role_id)
        )).scalar_one_or_none()
        if row:
            await session.delete(row)
            await session.commit()

    logger.info("custom_role.deleted", extra={"role_id": role_id, "role_name": name})
    return Response(status_code=204)
