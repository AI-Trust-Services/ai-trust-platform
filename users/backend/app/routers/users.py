from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import select

from app.keycloak import admin_client, current_realm
from ai_trust_logging import get_logger
from app.schemas import (
    InviteUserRequest,
    UpdateUserRequest,
    UserDetail,
    UserSummary,
    UsersListResponse,
)
from ai_trust_authorization import openfga_client, require_permission
from ai_trust_authorization.constants import BUILT_IN_ROLES
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.custom_role import CustomRole
from app.routers.custom_roles import _role_object

router = APIRouter(prefix="/users", tags=["users"])
logger = get_logger(__name__)

MANAGED_ROLES = set(BUILT_IN_ROLES)


async def _is_valid_role(role_name: str) -> bool:
    if role_name in MANAGED_ROLES:
        return True
    async with SessionLocal() as session:
        custom = (await session.execute(
            select(CustomRole).where(CustomRole.name == role_name)
        )).scalar_one_or_none()
    return custom is not None


async def _build_slug_map() -> dict[str, str]:
    async with SessionLocal() as session:
        rows = (await session.execute(select(CustomRole))).scalars().all()
    return {row.name.lower().replace(" ", "_"): row.name for row in rows}


async def _user_roles(username: str, slug_map: dict[str, str] | None = None) -> list[str]:
    role_objects = await openfga_client.read_user_roles(f"user:{username}")
    slugs = [r.removeprefix("role:") for r in role_objects]
    custom_slugs = [s for s in slugs if s not in MANAGED_ROLES]

    if custom_slugs and slug_map is None:
        slug_map = await _build_slug_map()

    return [
        slug if slug in MANAGED_ROLES else (slug_map or {}).get(slug, slug)
        for slug in slugs
    ]


async def _to_summary(u: dict, slug_map: dict[str, str] | None = None) -> UserSummary:
    username = u.get("username")
    if not username:
        logger.warning("user.missing_username", extra={"user_id": u["id"]})
    return UserSummary(
        id=u["id"],
        username=username or "",
        email=u.get("email", ""),
        firstName=u.get("firstName", ""),
        lastName=u.get("lastName", ""),
        enabled=u.get("enabled", False),
        emailVerified=u.get("emailVerified", False),
        createdTimestamp=u.get("createdTimestamp"),
        roles=await _user_roles(username or "", slug_map),
    )


async def _to_detail(u: dict, slug_map: dict[str, str] | None = None) -> UserDetail:
    summary = await _to_summary(u, slug_map)
    return UserDetail(**summary.model_dump(), attributes=u.get("attributes", {}))


@router.get("", response_model=UsersListResponse)
async def list_users(
    search: Optional[str] = Query(None),
    enabled: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: str = Depends(require_permission("iam:manage")),
):
    params: dict = {"max": limit, "first": offset}
    if search:
        params["search"] = search
    if enabled is not None:
        params["enabled"] = str(enabled).lower()

    with admin_client(current_realm()) as kc:
        resp = kc.get("/users", params=params)
        resp.raise_for_status()
        users = [u for u in resp.json() if not u.get("username", "").startswith("service-account-")]

        count_params = {"search": search} if search else {}
        count_resp = kc.get("/users/count", params=count_params)
        count_resp.raise_for_status()
        raw_total = count_resp.json()

        sa_count_resp = kc.get("/users/count", params={"search": "service-account-"})
        sa_count_resp.raise_for_status()
        total = raw_total - sa_count_resp.json()

    slug_map = await _build_slug_map()
    sem = asyncio.Semaphore(10)

    async def _bounded(u: dict) -> UserSummary:
        async with sem:
            return await _to_summary(u, slug_map)

    summaries = await asyncio.gather(*[_bounded(u) for u in users])
    return UsersListResponse(total=total, users=list(summaries))


@router.post("", response_model=UserDetail, status_code=201)
async def invite_user(body: InviteUserRequest, _: str = Depends(require_permission("iam:manage"))):
    payload = {
        "username": body.username,
        "email": body.email,
        "firstName": body.firstName,
        "lastName": body.lastName,
        "enabled": True,
        "emailVerified": True,
        "credentials": [{"type": "password", "value": body.temporaryPassword, "temporary": True}],
        "attributes": {
            "department": [body.department],
            "businessUnit": [body.businessUnit],
            "jobTitle": [body.jobTitle],
            "phone": [body.phone],
            "preferredLanguage": [body.preferredLanguage],
        },
    }
    with admin_client(current_realm()) as kc:
        resp = kc.post("/users", json=payload)
        if resp.status_code == 409:
            raise HTTPException(409, "A user with that username or email already exists.")
        if resp.status_code == 400:
            kc_error = resp.json()
            msg = kc_error.get("errorMessage", "Invalid user data.")
            logger.warning("user.create_failed", extra={"keycloak_response": kc_error})
            raise HTTPException(400, msg)
        resp.raise_for_status()

        location = resp.headers.get("Location", "")
        user_id = location.rstrip("/").split("/")[-1]
        user_resp = kc.get(f"/users/{user_id}")
        user_resp.raise_for_status()
        return await _to_detail(user_resp.json())


@router.get("/by-role", response_model=list[dict])
async def users_by_role(
    role: str = Query(...),
    _: str = Depends(require_permission("systems:read")),
):
    members = await openfga_client.read_role_members(f"role:{role}")
    usernames = [m.removeprefix("user:") for m in members]
    if not usernames:
        return []

    results: list[dict] = []
    sem = asyncio.Semaphore(10)

    async def _fetch(username: str) -> dict | None:
        async with sem:
            try:
                with admin_client(current_realm()) as kc:
                    resp = kc.get("/users", params={"username": username, "exact": "true"})
                    resp.raise_for_status()
                    users = resp.json()
                if not users:
                    return None
                u = users[0]
                return {
                    "username": u.get("username", ""),
                    "firstName": u.get("firstName", ""),
                    "lastName": u.get("lastName", ""),
                }
            except Exception:
                logger.warning("user.by_role_fetch_failed", extra={"username": username})
                return None

    fetched = await asyncio.gather(*[_fetch(u) for u in usernames])
    results = [r for r in fetched if r is not None]
    return results


@router.get("/{user_id}", response_model=UserDetail)
async def get_user(user_id: str, _: str = Depends(require_permission("iam:manage"))):
    with admin_client(current_realm()) as kc:
        resp = kc.get(f"/users/{user_id}")
        if resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        resp.raise_for_status()
        return await _to_detail(resp.json())


@router.put("/{user_id}", response_model=UserDetail)
async def update_user(user_id: str, body: UpdateUserRequest, _: str = Depends(require_permission("iam:manage"))):
    with admin_client(current_realm()) as kc:
        existing_resp = kc.get(f"/users/{user_id}")
        if existing_resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        existing_resp.raise_for_status()
        existing = existing_resp.json()

        attrs = existing.get("attributes", {})
        for field in ("department", "businessUnit", "jobTitle", "phone", "preferredLanguage"):
            val = getattr(body, field, None)
            if val is not None:
                attrs[field] = [val]

        payload = {**existing}
        if body.firstName is not None:
            payload["firstName"] = body.firstName
        if body.lastName is not None:
            payload["lastName"] = body.lastName
        if body.email is not None:
            payload["email"] = body.email
        payload["attributes"] = attrs

        kc.put(f"/users/{user_id}", json=payload).raise_for_status()
        updated = kc.get(f"/users/{user_id}")
        updated.raise_for_status()
        return await _to_detail(updated.json())


@router.post("/{user_id}/deactivate", response_model=UserDetail)
async def deactivate_user(user_id: str, _: str = Depends(require_permission("iam:manage"))):
    with admin_client(current_realm()) as kc:
        existing_resp = kc.get(f"/users/{user_id}")
        if existing_resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        existing_resp.raise_for_status()
        existing = existing_resp.json()
        kc.put(f"/users/{user_id}", json={**existing, "enabled": False}).raise_for_status()
        updated = kc.get(f"/users/{user_id}")
        updated.raise_for_status()
        return await _to_detail(updated.json())


@router.post("/{user_id}/activate", response_model=UserDetail)
async def activate_user(user_id: str, _: str = Depends(require_permission("iam:manage"))):
    with admin_client(current_realm()) as kc:
        existing_resp = kc.get(f"/users/{user_id}")
        if existing_resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        existing_resp.raise_for_status()
        existing = existing_resp.json()
        kc.put(f"/users/{user_id}", json={**existing, "enabled": True}).raise_for_status()
        updated = kc.get(f"/users/{user_id}")
        updated.raise_for_status()
        return await _to_detail(updated.json())


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: str, _: str = Depends(require_permission("iam:manage"))):
    with admin_client(current_realm()) as kc:
        resp = kc.delete(f"/users/{user_id}")
        if resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        resp.raise_for_status()


@router.post("/{user_id}/roles/{role_name}", response_model=UserDetail)
async def assign_role(user_id: str, role_name: str, _: str = Depends(require_permission("iam:manage"))):
    if not await _is_valid_role(role_name):
        raise HTTPException(400, f"Unknown role '{role_name}'.")

    with admin_client(current_realm()) as kc:
        user_resp = kc.get(f"/users/{user_id}")
        if user_resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        user_resp.raise_for_status()
        user = user_resp.json()

    username = user.get("username")
    if not username:
        raise HTTPException(500, "Keycloak returned a user without a username.")

    # Single-role invariant + last-admin guard both need the current memberships.
    existing_fga_roles = await openfga_client.read_user_roles(f"user:{username}")

    # Guard: don't demote the last platform_administrator. Only relevant when the
    # user currently *is* an admin being moved to a different role.
    if "role:platform_administrator" in existing_fga_roles and role_name != "platform_administrator":
        pa_members = await openfga_client.read_role_members("role:platform_administrator")
        if len(pa_members) <= 1:
            raise HTTPException(409, "Cannot reassign the last platform administrator.")

    # Single-role invariant: remove existing FGA memberships before writing new one.
    for role_obj in existing_fga_roles:
        await openfga_client.delete_tuple(f"user:{username}", "member", role_obj)
    await openfga_client.write_tuple(f"user:{username}", "member", _role_object(role_name))

    logger.info("user.role_assigned", extra={"username": username, "role": role_name})
    # Keycloak fields are unchanged by the role write; _to_detail re-reads roles
    # from OpenFGA, so the response reflects the new assignment.
    return await _to_detail(user)


@router.delete("/{user_id}/roles/{role_name}", response_model=UserDetail)
async def remove_role(user_id: str, role_name: str, _: str = Depends(require_permission("iam:manage"))):
    if not await _is_valid_role(role_name):
        raise HTTPException(400, f"Unknown role '{role_name}'.")

    with admin_client(current_realm()) as kc:
        user_resp = kc.get(f"/users/{user_id}")
        if user_resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        user_resp.raise_for_status()
        user = user_resp.json()

    username = user.get("username")
    if not username:
        raise HTTPException(500, "Keycloak returned a user without a username.")

    await openfga_client.delete_tuple(f"user:{username}", "member", _role_object(role_name))

    logger.info("user.role_removed", extra={"username": username, "role": role_name})
    return await _to_detail(user)


internal_router = APIRouter(prefix="/internal", tags=["internal"])


@internal_router.post("/users/email-lookup")
async def email_lookup(username: str = Body(..., embed=True)) -> dict:
    with admin_client(current_realm()) as kc:
        resp = kc.get("/users", params={"username": username, "exact": "true"})
        resp.raise_for_status()
        users = resp.json()
    if not users:
        return {"email": None}
    return {"email": users[0].get("email") or None}
