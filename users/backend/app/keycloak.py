import os
import time
import httpx

from fastapi import HTTPException

from ai_trust_tenancy.context import tenant_id_var

KEYCLOAK_URL = os.environ["KEYCLOAK_URL"]

# --- Auth strategy -----------------------------------------------------------------
# Multi-tenant (TENANCY_MODE=jwt): user management is per-tenant. Each tenant is its own
# Keycloak realm (realm == tenant_id == org). There is no per-realm service-account client;
# instead we authenticate with the MESH Keycloak bootstrap admin (the same creds the MT
# operator / kc-client Job use) via a password grant on the master realm, and target
# /admin/realms/<tenant>. The realm is resolved per-request from the verified JWT (tenant_id_var).
#
# Single-tenant (TENANCY_MODE=single, the standalone deploy): unchanged behaviour — a fixed
# KEYCLOAK_REALM managed via the users-backend service-account client (client_credentials).
TENANCY_MODE = os.environ.get("TENANCY_MODE", "single").strip().lower()

# Mesh admin creds (jwt mode). Mirrors operator/helpers.go:kcAdminToken + keycloak-client-job.tmpl.
MESH_KC_ADMIN_USER = os.environ.get("MESH_KC_ADMIN_USER", "")
MESH_KC_ADMIN_PASSWORD = os.environ.get("MESH_KC_ADMIN_PASSWORD", "")

# Single-tenant service-account client (single mode only).
LEGACY_REALM = os.environ.get("KEYCLOAK_REALM", "ai-trust")
LEGACY_CLIENT_ID = os.environ.get("USERS_BACKEND_CLIENT_ID", "")
LEGACY_CLIENT_SECRET = os.environ.get("USERS_BACKEND_CLIENT_SECRET", "")

_token: str | None = None
_token_expiry: float = 0.0


def _fetch_token() -> tuple[str, int]:
    """Return (access_token, expires_in). jwt mode → mesh admin password grant on master;
    single mode → the legacy users-backend service-account client_credentials grant."""
    if TENANCY_MODE == "jwt":
        if not (MESH_KC_ADMIN_USER and MESH_KC_ADMIN_PASSWORD):
            raise HTTPException(500, "users-backend misconfigured: MESH_KC_ADMIN_USER/PASSWORD not set")
        resp = httpx.post(
            f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": MESH_KC_ADMIN_USER,
                "password": MESH_KC_ADMIN_PASSWORD,
            },
            timeout=10,
        )
    else:
        resp = httpx.post(
            f"{KEYCLOAK_URL}/realms/{LEGACY_REALM}/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": LEGACY_CLIENT_ID,
                "client_secret": LEGACY_CLIENT_SECRET,
            },
            timeout=10,
        )
    resp.raise_for_status()
    data = resp.json()
    return data["access_token"], int(data.get("expires_in", 60))


def _get_token() -> str:
    global _token, _token_expiry
    if _token and time.time() < _token_expiry - 30:
        return _token
    tok, expires_in = _fetch_token()
    _token = tok
    _token_expiry = time.time() + expires_in
    return _token


def current_realm() -> str:
    """The Keycloak realm to operate on for the current request.

    jwt mode: the verified tenant (realm == tenant_id == org). Fail-closed if unset —
    a request with no resolved tenant must not fall back to some default realm.
    single mode: the fixed KEYCLOAK_REALM.
    """
    if TENANCY_MODE == "jwt":
        realm = tenant_id_var.get()
        if not realm:
            raise HTTPException(400, "No tenant in request context — cannot resolve Keycloak realm.")
        return realm
    return LEGACY_REALM


def admin_client(realm: str) -> httpx.Client:
    """Keycloak Admin REST client scoped to `realm`. Pass current_realm() from a request handler."""
    return httpx.Client(
        base_url=f"{KEYCLOAK_URL}/admin/realms/{realm}",
        headers={"Authorization": f"Bearer {_get_token()}"},
        timeout=10,
    )
