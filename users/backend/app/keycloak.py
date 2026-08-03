import os
import time
import httpx

KEYCLOAK_URL = os.environ["KEYCLOAK_URL"]
REALM        = os.environ.get("KEYCLOAK_REALM", "ai-trust")
CLIENT_ID    = os.environ["USERS_BACKEND_CLIENT_ID"]
CLIENT_SECRET = os.environ["USERS_BACKEND_CLIENT_SECRET"]

_token: str | None = None
_token_expiry: float = 0.0


def _get_token() -> str:
    global _token, _token_expiry
    if _token and time.time() < _token_expiry - 30:
        return _token
    resp = httpx.post(
        f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _token = data["access_token"]
    _token_expiry = time.time() + data["expires_in"]
    return _token


def admin_client() -> httpx.Client:
    return httpx.Client(
        base_url=f"{KEYCLOAK_URL}/admin/realms/{REALM}",
        headers={"Authorization": f"Bearer {_get_token()}"},
        timeout=10,
    )
