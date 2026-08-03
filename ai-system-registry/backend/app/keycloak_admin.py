"""Minimal Keycloak Admin API client for listing realm users.

Reads KEYCLOAK_URL, KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD from the environment.
Used by the IAM router to populate the user list (no local user cache).
"""
import os

import httpx

from ai_trust_logging import get_logger

logger = get_logger(__name__)

REALM = "ai-trust"


def _config() -> tuple[str, str, str]:
    url = os.environ.get("KEYCLOAK_URL", "").strip()
    admin = os.environ.get("KEYCLOAK_ADMIN", "").strip()
    password = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "").strip()
    if not (url and admin and password):
        raise RuntimeError(
            "KEYCLOAK_URL, KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD must be set "
            "for the IAM user list."
        )
    return url, admin, password


async def _get_admin_token(client: httpx.AsyncClient, url: str, admin: str, password: str) -> str:
    resp = await client.post(
        f"{url}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": admin,
            "password": password,
        },
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


async def list_users() -> list[dict]:
    """Return the realm's users as dicts with username/email/name/enabled."""
    url, admin, password = _config()
    async with httpx.AsyncClient(timeout=10) as client:
        token = await _get_admin_token(client, url, admin, password)
        resp = await client.get(
            f"{url}/admin/realms/{REALM}/users",
            headers={"Authorization": f"Bearer {token}"},
            params={"max": 500},
        )
        resp.raise_for_status()
        users = resp.json()

    return [
        {
            "username": u.get("username", ""),
            "email": u.get("email"),
            "first_name": u.get("firstName"),
            "last_name": u.get("lastName"),
            "enabled": u.get("enabled", True),
        }
        for u in users
        if u.get("username")
    ]
