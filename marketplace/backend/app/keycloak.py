"""Per-app OIDC client provisioning for discovered marketplace apps.

Federation trust anchors, both minting a confidential client ``aitrust-app-{name}`` in the
``ai-trust`` realm, created idempotently on the first Enable:

  ``bearer`` mode          → the proxy forwards the caller's platform JWT to the app, and the app
                             validates it against that client's audience. See ``ensure_app_client``.
  ``oidc_federation`` mode → the app runs its OWN OIDC login, federated to the ``ai-trust`` realm as
                             an upstream IdP (real SSO transfer, zero app code). The client here is
                             the credential the app's IAS/IdP uses to broker TO the platform, and
                             its redirect URI is the APP's own IdP callback. See
                             ``ensure_federation_client`` + ``get_client_secret``.

Admin auth mirrors ``infra/keycloak/provision.py`` and ``users/backend/app/keycloak.py``: a
master-realm ``admin-cli`` password grant with ``KEYCLOAK_ADMIN`` / ``KEYCLOAK_ADMIN_PASSWORD``
(the users-backend service account lacks ``manage-clients``). The token is cached with a safety
margin. The admin password, access token, and any client SECRET are NEVER logged.
"""
import os
import time

import httpx
from fastapi import HTTPException

from ai_trust_logging import get_logger

log = get_logger(__name__)

KEYCLOAK_URL = os.environ["KEYCLOAK_URL"]
KEYCLOAK_ADMIN = os.environ["KEYCLOAK_ADMIN"]
KEYCLOAK_ADMIN_PASSWORD = os.environ["KEYCLOAK_ADMIN_PASSWORD"]
REALM = os.environ.get("KEYCLOAK_REALM", "ai-trust")

_token: str | None = None
_token_expiry: float = 0.0


def _fetch_token() -> tuple[str, int]:
    resp = httpx.post(
        f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": KEYCLOAK_ADMIN,
            "password": KEYCLOAK_ADMIN_PASSWORD,
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


def _admin() -> httpx.Client:
    return httpx.Client(
        base_url=f"{KEYCLOAK_URL}/admin/realms/{REALM}",
        headers={"Authorization": f"Bearer {_get_token()}"},
        timeout=10,
    )


def _ensure_client(name: str, redirect_uris: list[str], web_origins: list[str],
                   *, log_prefix: str, error_msg: str) -> str:
    """Idempotently create/update the confidential client ``aitrust-app-{name}`` and return its
    Keycloak clientId (the stable string, not the internal UUID).

    Shared by ``ensure_app_client`` (bearer) and ``ensure_federation_client`` (oidc_federation);
    they differ ONLY in the redirect-URI whitelist and the log-event / error wording, passed in.
    Raises 502 on any Keycloak failure. The token/password/secret are NEVER logged.
    """
    client_id = f"aitrust-app-{name}"
    config = {
        "clientId": client_id,
        "enabled": True,
        "protocol": "openid-connect",
        "publicClient": False,
        "redirectUris": redirect_uris,
        "webOrigins": web_origins,
        "standardFlowEnabled": True,
        "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": False,
        "fullScopeAllowed": True,
        "defaultClientScopes": ["basic", "openid", "profile", "email", "roles"],
    }
    try:
        with _admin() as c:
            existing = c.get("/clients", params={"clientId": client_id})
            existing.raise_for_status()
            rows = existing.json()
            if rows:
                c.put(f"/clients/{rows[0]['id']}", json=config).raise_for_status()
                log.info(f"{log_prefix}.updated", extra={"app": name, "client_id": client_id})
            else:
                c.post("/clients", json=config).raise_for_status()
                log.info(f"{log_prefix}.created", extra={"app": name, "client_id": client_id})
    except httpx.HTTPError as exc:
        # Never log the token/password; log only the app name + a safe status.
        status = getattr(getattr(exc, "response", None), "status_code", None)
        log.error(f"{log_prefix}.failed", extra={"app": name, "status": status})
        raise HTTPException(502, error_msg)
    return client_id


def ensure_app_client(name: str, base_url: str) -> str:
    """Idempotently create/update the confidential client ``aitrust-app-{name}`` and return its
    Keycloak clientId (the stable string, not the internal UUID).

    Called lazily on the first Enable of a ``bearer``-mode app. ``base_url`` is the app's canonical
    URL — redirect URIs are scoped to ``{base_url}/*`` and web origins to ``[base_url]`` so the app
    can complete an OIDC flow of its own if it chooses. Raises 502 on any Keycloak failure so the
    caller can surface a clean error (``header_map`` / ``none`` modes never call this).
    """
    base = base_url.rstrip("/")
    return _ensure_client(
        name,
        redirect_uris=[f"{base}/*"],
        web_origins=[base],
        log_prefix="marketplace.kc_client",
        error_msg=f"Could not provision Keycloak client for '{name}'",
    )


def ensure_federation_client(name: str, redirect_uri: str | None, base_url: str) -> str:
    """Idempotently create/update the confidential client ``aitrust-app-{name}`` for an
    ``oidc_federation`` app and return its Keycloak clientId.

    Unlike ``ensure_app_client``, the redirect URI here is the APP's own IdP/IAS callback — the reply
    URL the app's IdP uses when brokering to the platform ``ai-trust`` realm — supplied by the
    operator. When ``redirect_uri`` is set the client whitelists exactly that (no open wildcard);
    otherwise it falls back to ``{base_url}/*``. The client secret is created by Keycloak and read
    separately via ``get_client_secret`` (never persisted, never logged). Raises 502 on any Keycloak
    failure.
    """
    base = base_url.rstrip("/")
    redirect = (redirect_uri or "").strip()
    return _ensure_client(
        name,
        redirect_uris=[redirect] if redirect else [f"{base}/*"],
        web_origins=[base],
        log_prefix="marketplace.kc_federation_client",
        error_msg=f"Could not provision federation client for '{name}'",
    )


def _client_uuid(c: httpx.Client, client_id: str) -> str:
    """Resolve a Keycloak clientId (stable string) to its internal UUID, or raise 404."""
    resp = c.get("/clients", params={"clientId": client_id})
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        raise HTTPException(404, f"Keycloak client '{client_id}' not found")
    return rows[0]["id"]


def get_client_secret(client_id: str) -> str:
    """Return the current client secret for ``client_id`` (generating one if blank).

    Reads live from Keycloak — the secret is never persisted in the platform DB. Raises 502 on any
    Keycloak failure. The secret value is NEVER logged.
    """
    try:
        with _admin() as c:
            uuid = _client_uuid(c, client_id)
            resp = c.get(f"/clients/{uuid}/client-secret")
            resp.raise_for_status()
            value = (resp.json() or {}).get("value")
            if not value:
                # No secret yet (freshly created confidential client can have a blank one) — mint it.
                gen = c.post(f"/clients/{uuid}/client-secret")
                gen.raise_for_status()
                value = (gen.json() or {}).get("value")
            if not value:
                raise HTTPException(502, f"Keycloak returned no secret for '{client_id}'")
            return value
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        log.error("marketplace.kc_client_secret.failed", extra={"client_id": client_id, "status": status})
        raise HTTPException(502, f"Could not read Keycloak secret for '{client_id}'")


def rotate_client_secret(client_id: str) -> str:
    """Rotate and return a fresh client secret for ``client_id``. Never logs the value."""
    try:
        with _admin() as c:
            uuid = _client_uuid(c, client_id)
            resp = c.post(f"/clients/{uuid}/client-secret")
            resp.raise_for_status()
            value = (resp.json() or {}).get("value")
            if not value:
                raise HTTPException(502, f"Keycloak returned no secret for '{client_id}'")
            log.info("marketplace.kc_client_secret.rotated", extra={"client_id": client_id})
            return value
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        log.error("marketplace.kc_client_secret.rotate_failed", extra={"client_id": client_id, "status": status})
        raise HTTPException(502, f"Could not rotate Keycloak secret for '{client_id}'")
