from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.keycloak import admin_client
from app.schemas import (
    InviteUserRequest,
    UpdateUserRequest,
    UserDetail,
    UserSummary,
    UsersListResponse,
)

router = APIRouter(prefix="/users", tags=["users"])

MANAGED_ROLES = {
    "platform_administrator",
    "ai_engineer",
    "business_owner",
    "ai_compliance_officer",
    "auditor",
    "executive",
}


def _user_roles(user_id: str) -> list[str]:
    with admin_client() as kc:
        resp = kc.get(f"/users/{user_id}/role-mappings/realm")
        if not resp.is_success:
            return []
        return [r["name"] for r in resp.json() if r["name"] in MANAGED_ROLES]


def _to_summary(u: dict) -> UserSummary:
    return UserSummary(
        id=u["id"],
        username=u.get("username", ""),
        email=u.get("email", ""),
        firstName=u.get("firstName", ""),
        lastName=u.get("lastName", ""),
        enabled=u.get("enabled", False),
        emailVerified=u.get("emailVerified", False),
        createdTimestamp=u.get("createdTimestamp"),
        roles=_user_roles(u["id"]),
    )


def _to_detail(u: dict) -> UserDetail:
    summary = _to_summary(u)
    return UserDetail(**summary.model_dump(), attributes=u.get("attributes", {}))


@router.get("", response_model=UsersListResponse)
def list_users(
    search: Optional[str] = Query(None),
    enabled: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    params: dict = {"max": limit, "first": offset}
    if search:
        params["search"] = search
    if enabled is not None:
        params["enabled"] = str(enabled).lower()

    with admin_client() as kc:
        resp = kc.get("/users", params=params)
        resp.raise_for_status()
        users = resp.json()

        count_params = {"search": search} if search else {}
        count_resp = kc.get("/users/count", params=count_params)
        count_resp.raise_for_status()
        total = count_resp.json()

    return UsersListResponse(total=total, users=[_to_summary(u) for u in users])


@router.post("", response_model=UserDetail, status_code=201)
def invite_user(body: InviteUserRequest):
    payload = {
        "username": body.username,
        "email": body.email,
        "firstName": body.firstName,
        "lastName": body.lastName,
        "enabled": True,
        "emailVerified": False,
        "credentials": [{"type": "password", "value": body.temporaryPassword, "temporary": True}],
        "attributes": {
            "department": [body.department],
            "businessUnit": [body.businessUnit],
            "jobTitle": [body.jobTitle],
            "phone": [body.phone],
            "preferredLanguage": [body.preferredLanguage],
        },
    }
    with admin_client() as kc:
        resp = kc.post("/users", json=payload)
        if resp.status_code == 409:
            raise HTTPException(409, "A user with that username or email already exists.")
        resp.raise_for_status()

        location = resp.headers.get("Location", "")
        user_id = location.rstrip("/").split("/")[-1]
        user_resp = kc.get(f"/users/{user_id}")
        user_resp.raise_for_status()
        return _to_detail(user_resp.json())


@router.get("/{user_id}", response_model=UserDetail)
def get_user(user_id: str):
    with admin_client() as kc:
        resp = kc.get(f"/users/{user_id}")
        if resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        resp.raise_for_status()
        return _to_detail(resp.json())


@router.put("/{user_id}", response_model=UserDetail)
def update_user(user_id: str, body: UpdateUserRequest):
    with admin_client() as kc:
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
        return _to_detail(updated.json())


@router.post("/{user_id}/deactivate", response_model=UserDetail)
def deactivate_user(user_id: str):
    with admin_client() as kc:
        existing_resp = kc.get(f"/users/{user_id}")
        if existing_resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        existing_resp.raise_for_status()
        existing = existing_resp.json()
        kc.put(f"/users/{user_id}", json={**existing, "enabled": False}).raise_for_status()
        updated = kc.get(f"/users/{user_id}")
        updated.raise_for_status()
        return _to_detail(updated.json())


@router.post("/{user_id}/activate", response_model=UserDetail)
def activate_user(user_id: str):
    with admin_client() as kc:
        existing_resp = kc.get(f"/users/{user_id}")
        if existing_resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        existing_resp.raise_for_status()
        existing = existing_resp.json()
        kc.put(f"/users/{user_id}", json={**existing, "enabled": True}).raise_for_status()
        updated = kc.get(f"/users/{user_id}")
        updated.raise_for_status()
        return _to_detail(updated.json())


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: str):
    with admin_client() as kc:
        resp = kc.delete(f"/users/{user_id}")
        if resp.status_code == 404:
            raise HTTPException(404, "User not found.")
        resp.raise_for_status()


@router.post("/{user_id}/roles/{role_name}", response_model=UserDetail)
def assign_role(user_id: str, role_name: str):
    if role_name not in MANAGED_ROLES:
        raise HTTPException(400, f"Unknown role '{role_name}'.")
    with admin_client() as kc:
        role_resp = kc.get(f"/roles/{role_name}")
        if role_resp.status_code == 404:
            raise HTTPException(404, f"Role '{role_name}' not found in Keycloak.")
        role_resp.raise_for_status()
        kc.post(
            f"/users/{user_id}/role-mappings/realm",
            json=[role_resp.json()],
        ).raise_for_status()
        updated = kc.get(f"/users/{user_id}")
        updated.raise_for_status()
        return _to_detail(updated.json())


@router.delete("/{user_id}/roles/{role_name}", response_model=UserDetail)
def remove_role(user_id: str, role_name: str):
    if role_name not in MANAGED_ROLES:
        raise HTTPException(400, f"Unknown role '{role_name}'.")
    with admin_client() as kc:
        role_resp = kc.get(f"/roles/{role_name}")
        if role_resp.status_code == 404:
            raise HTTPException(404, f"Role '{role_name}' not found in Keycloak.")
        role_resp.raise_for_status()
        kc.delete(
            f"/users/{user_id}/role-mappings/realm",
            json=[role_resp.json()],
        ).raise_for_status()
        updated = kc.get(f"/users/{user_id}")
        updated.raise_for_status()
        return _to_detail(updated.json())
