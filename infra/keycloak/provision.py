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

Optional env vars:
  PROVISION_DEV_USERS         set to "true" to create dev users (local only)
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
PROVISION_DEV_USERS          = os.environ.get("PROVISION_DEV_USERS", "false").lower() == "true"

REALM = "ai-trust"

ROLES = [
    "platform_administrator",
    "ai_engineer",
    "app_owner",
    "compliance_officer",
    "risk_manager",
    "auditor",
    "executive",
]

DEV_USER_ROLES = {
    "admin":      "platform_administrator",
    "engineer":   "ai_engineer",
    "compliance": "compliance_officer",
    "auditor":    "auditor",
}


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
        # "none" is fine for local dev (HTTP). Use "external" or "all" in production.
        "sslRequired": "none",
        "registrationAllowed": False,
        "loginWithEmailAllowed": False,
        "accessTokenLifespan": 900,
        "ssoSessionIdleTimeout": 28800,
        "ssoSessionMaxLifespan": 28800,
    }
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


def ensure_roles(client: httpx.Client) -> None:
    existing_resp = client.get(f"{KEYCLOAK_URL}/admin/realms/{REALM}/roles")
    existing_resp.raise_for_status()
    existing_names = {r["name"] for r in existing_resp.json()}
    for role in ROLES:
        if role in existing_names:
            print(f"Role '{role}' already exists, skipping.")
        else:
            print(f"Creating role '{role}'...")
            client.post(
                f"{KEYCLOAK_URL}/admin/realms/{REALM}/roles",
                json={"name": role},
            ).raise_for_status()


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
    manage_users_role = next(
        r for r in rm_roles_resp.json() if r["name"] == "manage-users"
    )

    already_assigned = client.get(
        f"{KEYCLOAK_URL}/admin/realms/{REALM}/users/{sa_user_id}/role-mappings/clients/{rm_client_id}"
    ).json()
    already_names = {r["name"] for r in already_assigned}
    if "manage-users" not in already_names:
        print("Granting manage-users to users-backend service account...")
        client.post(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/users/{sa_user_id}/role-mappings/clients/{rm_client_id}",
            json=[manage_users_role],
        ).raise_for_status()
    else:
        print("users-backend service account already has manage-users.")


def assign_dev_user_roles(client: httpx.Client) -> None:
    for username, role_name in DEV_USER_ROLES.items():
        users = client.get(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/users",
            params={"username": username, "exact": "true"},
        ).json()
        if not users:
            print(f"Dev user '{username}' not found, skipping role assignment.")
            continue
        user_id = users[0]["id"]

        role_resp = client.get(f"{KEYCLOAK_URL}/admin/realms/{REALM}/roles/{role_name}")
        role_resp.raise_for_status()
        role = role_resp.json()

        existing = client.get(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/users/{user_id}/role-mappings/realm"
        ).json()
        if any(r["name"] == role_name for r in existing):
            print(f"Dev user '{username}' already has role '{role_name}', skipping.")
            continue

        print(f"Assigning role '{role_name}' to dev user '{username}'...")
        client.post(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/users/{user_id}/role-mappings/realm",
            json=[role],
        ).raise_for_status()


def ensure_dev_users(client: httpx.Client) -> None:
    dev_users = [
        {"username": "admin",      "email": "admin@local.dev",      "firstName": "Platform",   "lastName": "Admin"},
        {"username": "engineer",   "email": "engineer@local.dev",   "firstName": "AI",         "lastName": "Engineer"},
        {"username": "compliance", "email": "compliance@local.dev", "firstName": "Compliance", "lastName": "Officer"},
        {"username": "auditor",    "email": "auditor@local.dev",    "firstName": "Platform",   "lastName": "Auditor"},
    ]
    passwords = {
        "admin": "admin123", "engineer": "engineer123",
        "compliance": "compliance123", "auditor": "auditor123",
    }
    for u in dev_users:
        existing = client.get(f"{KEYCLOAK_URL}/admin/realms/{REALM}/users", params={"username": u["username"]}).json()
        if existing:
            print(f"Dev user '{u['username']}' already exists, skipping.")
            continue
        print(f"Creating dev user '{u['username']}'...")
        client.post(f"{KEYCLOAK_URL}/admin/realms/{REALM}/users", json={
            "username": u["username"],
            "email": u["email"],
            "firstName": u["firstName"],
            "lastName": u["lastName"],
            "enabled": True,
            "emailVerified": True,
            "credentials": [{"type": "password", "value": passwords[u["username"]], "temporary": False}],
        }).raise_for_status()


def main() -> None:
    with httpx.Client(timeout=10) as client:
        token = get_admin_token(client)
        client.headers["Authorization"] = f"Bearer {token}"

        ensure_realm(client)
        ensure_client(client)
        ensure_roles(client)
        ensure_users_backend_client(client)

        if PROVISION_DEV_USERS:
            print("Provisioning dev users...")
            ensure_dev_users(client)
            assign_dev_user_roles(client)
        else:
            print("Skipping dev users (PROVISION_DEV_USERS not set).")

    print("Keycloak provisioning complete.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
