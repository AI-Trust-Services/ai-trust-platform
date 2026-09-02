#!/usr/bin/env python3
"""
Keycloak provisioning script.
Runs once after Keycloak is healthy. Idempotent — safe to re-run.

Required env vars:
  KEYCLOAK_URL                internal URL e.g. http://keycloak:8080
  KEYCLOAK_ADMIN              admin username
  KEYCLOAK_ADMIN_PASSWORD     admin password
  APP_PUBLIC_URL              public app URL e.g. https://app.yourdomain.com
  KEYCLOAK_CLIENT_SECRET      secret for the oauth2-proxy client
  USERS_BACKEND_CLIENT_SECRET secret for the users-backend service account client
  APP_ADMIN_USERNAME          bootstrap platform admin username
  APP_ADMIN_PASSWORD          bootstrap platform admin password
"""
import os
import sys
import httpx

KEYCLOAK_URL                 = os.environ["KEYCLOAK_URL"]
ADMIN                        = os.environ["KEYCLOAK_ADMIN"]
ADMIN_PASSWORD               = os.environ["KEYCLOAK_ADMIN_PASSWORD"]
APP_PUBLIC_URL               = os.environ["APP_PUBLIC_URL"]
CLIENT_SECRET                = os.environ["KEYCLOAK_CLIENT_SECRET"]
USERS_BACKEND_CLIENT_SECRET  = os.environ["USERS_BACKEND_CLIENT_SECRET"]
APP_ADMIN_USERNAME           = os.environ["APP_ADMIN_USERNAME"]
APP_ADMIN_PASSWORD           = os.environ["APP_ADMIN_PASSWORD"]

REALM = "ai-trust"
KEYCLOAK_PUBLIC_URL = os.environ.get("KEYCLOAK_PUBLIC_URL", "")

DEV_USERS = [
    {"username": "dev-owner",      "firstName": "Dev", "lastName": "Business Owner"},
    {"username": "dev-engineer",   "firstName": "Dev", "lastName": "AI Engineer"},
    {"username": "dev-compliance", "firstName": "Dev", "lastName": "Compliance Officer"},
]


def get_admin_token(client: httpx.Client) -> str:
    resp = client.post(
        f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": ADMIN,
            "password": ADMIN_PASSWORD,
        },
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def ensure_realm(client: httpx.Client) -> None:
    realm_config = {
        "realm": REALM,
        "enabled": True,
        "displayName": "AI Trust Platform",
        "sslRequired": "none",
        "registrationAllowed": False,
        "loginWithEmailAllowed": False,
        "accessTokenLifespan": 900,
        "ssoSessionIdleTimeout": 28800,
        "ssoSessionMaxLifespan": 28800,
    }
    if KEYCLOAK_PUBLIC_URL:
        realm_config["attributes"] = {"frontendUrl": KEYCLOAK_PUBLIC_URL}
    resp = client.get(f"{KEYCLOAK_URL}/admin/realms/{REALM}")
    if resp.status_code == 200:
        print(f"Realm '{REALM}' already exists, updating...")
        client.put(f"{KEYCLOAK_URL}/admin/realms/{REALM}", json=realm_config).raise_for_status()
    else:
        print(f"Creating realm '{REALM}'...")
        client.post(f"{KEYCLOAK_URL}/admin/realms", json=realm_config).raise_for_status()


def ensure_client(client: httpx.Client) -> None:
    existing = client.get(f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients", params={"clientId": "oauth2-proxy"}).json()

    config = {
        "clientId": "oauth2-proxy",
        "enabled": True,
        "protocol": "openid-connect",
        "publicClient": False,
        "secret": CLIENT_SECRET,
        "redirectUris": [f"{APP_PUBLIC_URL}/oauth2/callback"],
        "webOrigins": [APP_PUBLIC_URL],
        "standardFlowEnabled": True,
        "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": False,
        "fullScopeAllowed": True,
        "defaultClientScopes": ["basic", "openid", "profile", "email", "roles"],
    }

    if existing:
        print("Updating oauth2-proxy client...")
        client_id = existing[0]["id"]
        client.put(f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients/{client_id}", json=config).raise_for_status()
    else:
        print("Creating oauth2-proxy client...")
        client.post(f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients", json=config).raise_for_status()


def ensure_users_backend_client(client: httpx.Client) -> None:
    existing = client.get(
        f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients",
        params={"clientId": "users-backend"},
    ).json()

    config = {
        "clientId": "users-backend",
        "enabled": True,
        "protocol": "openid-connect",
        "publicClient": False,
        "secret": USERS_BACKEND_CLIENT_SECRET,
        "standardFlowEnabled": False,
        "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": True,
    }

    if existing:
        print("Updating users-backend client...")
        client_id = existing[0]["id"]
        client.put(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients/{client_id}",
            json=config,
        ).raise_for_status()
    else:
        print("Creating users-backend client...")
        client.post(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients",
            json=config,
        ).raise_for_status()

    # Grant the service account the realm-management 'manage-users' role so it
    # can create/edit/delete users via the Admin API.
    sa_resp = client.get(
        f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients",
        params={"clientId": "users-backend"},
    )
    sa_resp.raise_for_status()
    ub_client_id = sa_resp.json()[0]["id"]

    sa_user_resp = client.get(
        f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients/{ub_client_id}/service-account-user"
    )
    sa_user_resp.raise_for_status()
    sa_user_id = sa_user_resp.json()["id"]

    rm_resp = client.get(
        f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients",
        params={"clientId": "realm-management"},
    )
    rm_resp.raise_for_status()
    rm_client_id = rm_resp.json()[0]["id"]

    rm_roles_resp = client.get(
        f"{KEYCLOAK_URL}/admin/realms/{REALM}/clients/{rm_client_id}/roles"
    )
    rm_roles_resp.raise_for_status()
    needed_roles = {r["name"]: r for r in rm_roles_resp.json() if r["name"] in ("manage-users", "view-realm", "manage-realm")}

    already_assigned = client.get(
        f"{KEYCLOAK_URL}/admin/realms/{REALM}/users/{sa_user_id}/role-mappings/clients/{rm_client_id}"
    ).json()
    already_names = {r["name"] for r in already_assigned}

    to_assign = [r for name, r in needed_roles.items() if name not in already_names]
    if to_assign:
        print(f"Granting {[r['name'] for r in to_assign]} to users-backend service account...")
        client.post(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/users/{sa_user_id}/role-mappings/clients/{rm_client_id}",
            json=to_assign,
        ).raise_for_status()
    else:
        print("users-backend service account already has required roles.")


def ensure_admin_user(client: httpx.Client) -> None:
    existing = client.get(f"{KEYCLOAK_URL}/admin/realms/{REALM}/users", params={"username": APP_ADMIN_USERNAME}).json()
    if existing:
        print(f"Admin user '{APP_ADMIN_USERNAME}' already exists, skipping.")
        return
    print(f"Creating admin user '{APP_ADMIN_USERNAME}'...")
    client.post(f"{KEYCLOAK_URL}/admin/realms/{REALM}/users", json={
        "username": APP_ADMIN_USERNAME,
        "email": f"{APP_ADMIN_USERNAME}@local.dev",  # TODO: do we want to require a real email for the admin user? If yes, we will move it to env var.
        "emailVerified": True,
        "firstName": "Platform",
        "lastName": "Admin",
        "enabled": True,
        "credentials": [{"type": "password", "value": APP_ADMIN_PASSWORD, "temporary": False}],
    }).raise_for_status()


def ensure_dev_users(client: httpx.Client) -> None:
    if os.environ.get("SEED_DEV_USERS", "").lower() != "true":
        return
    for user in DEV_USERS:
        existing = client.get(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/users",
            params={"username": user["username"]},
        ).json()
        if existing:
            print(f"Dev user '{user['username']}' already exists, skipping.")
            continue
        print(f"Creating dev user '{user['username']}'...")
        client.post(f"{KEYCLOAK_URL}/admin/realms/{REALM}/users", json={
            "username":      user["username"],
            "email":         f"{user['username']}@local.dev",
            "firstName":     user["firstName"],
            "lastName":      user["lastName"],
            "enabled":       True,
            "emailVerified": True,
            "credentials":   [{"type": "password", "value": "password", "temporary": False}],
        }).raise_for_status()


def main() -> None:
    with httpx.Client(timeout=10) as client:
        token = get_admin_token(client)
        client.headers["Authorization"] = f"Bearer {token}"

        ensure_realm(client)
        ensure_client(client)
        ensure_users_backend_client(client)
        ensure_admin_user(client)
        ensure_dev_users(client)

    print("Keycloak provisioning complete.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
