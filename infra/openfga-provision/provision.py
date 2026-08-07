#!/usr/bin/env python3
"""OpenFGA provisioning script.

Runs once after OpenFGA is healthy. Idempotent — safe to re-run.

Steps:
  1. Find (or create) the store named "ai-trust".
  2. Write the authorization model (flat RBAC against platform:global).
  3. Seed role→permission tuples for all built-in roles.
  4. If INITIAL_ADMIN_USER is set, assign it the platform_administrator role.
  5. Write the store ID to /config/store_id on the shared volume so backends
     can read it on startup.

Required env vars:
  OPENFGA_URL            internal URL e.g. http://openfga:8080

Optional env vars:
  OPENFGA_STORE_NAME     store name (default "ai-trust")
  OPENFGA_STORE_ID_FILE  path to write store ID (default /config/store_id)
  INITIAL_ADMIN_USER     username to seed as platform_administrator
"""
import asyncio
import os
import sys

from openfga_sdk import ClientConfiguration, OpenFgaClient
from openfga_sdk.client.models import ClientTuple, ClientWriteRequest
from openfga_sdk.models.create_store_request import CreateStoreRequest
from openfga_sdk.models.write_authorization_model_request import (
    WriteAuthorizationModelRequest,
)

from ai_trust_authorization.constants import (
    PLATFORM_OBJECT,
    RELATION_BY_PERMISSION,
    ROLE_PERMISSIONS,
)

OPENFGA_URL = os.environ["OPENFGA_URL"]
STORE_NAME = os.environ.get("OPENFGA_STORE_NAME", "ai-trust")
STORE_ID_FILE = os.environ.get("OPENFGA_STORE_ID_FILE", "/config/store_id")
INITIAL_ADMIN_USER = os.environ.get("INITIAL_ADMIN_USER", "").strip()

# platform:global split into (type, id) for tuple objects.
PLATFORM_TYPE, PLATFORM_ID = PLATFORM_OBJECT.split(":", 1)


def build_model() -> dict:
    """Build the authorization model JSON from the shared permission constants.

    Every relation on `platform` is directly assignable to `role#member`, so a
    user gains a permission by being a member of a role that has that relation.
    """
    platform_relations = {}
    platform_metadata = {}
    for relation in RELATION_BY_PERMISSION.values():
        platform_relations[relation] = {"this": {}}
        platform_metadata[relation] = {
            "directly_related_user_types": [{"type": "role", "relation": "member"}]
        }

    return {
        "schema_version": "1.1",
        "type_definitions": [
            {"type": "user", "relations": {}},
            {
                "type": "role",
                "relations": {"member": {"this": {}}},
                "metadata": {
                    "relations": {
                        "member": {"directly_related_user_types": [{"type": "user"}]}
                    }
                },
            },
            {
                "type": PLATFORM_TYPE,
                "relations": platform_relations,
                "metadata": {"relations": platform_metadata},
            },
        ],
    }


async def find_or_create_store(client: OpenFgaClient) -> str:
    """Return the ID of the store named STORE_NAME, creating it if absent."""
    response = await client.list_stores()
    for store in response.stores or []:
        if store.name == STORE_NAME:
            print(f"Store '{STORE_NAME}' already exists: {store.id}")
            return store.id

    print(f"Creating store '{STORE_NAME}'...")
    created = await client.create_store(CreateStoreRequest(name=STORE_NAME))
    print(f"Created store: {created.id}")
    return created.id


async def write_model_if_needed(client: OpenFgaClient) -> None:
    existing = await client.read_authorization_models()
    if existing.authorization_models:
        print("Authorization model already exists, skipping write.")
        return
    await write_model(client)


async def write_model(client: OpenFgaClient) -> None:
    model = build_model()
    request = WriteAuthorizationModelRequest(
        schema_version=model["schema_version"],
        type_definitions=model["type_definitions"],
    )
    response = await client.write_authorization_model(request)
    print(f"Wrote authorization model: {response.authorization_model_id}")


async def seed_role_tuples(client: OpenFgaClient) -> None:
    """Write role→permission tuples for all built-in roles.

    OpenFGA's write is not on-conflict-safe: writing an existing tuple errors.
    We write each tuple individually and ignore 'already exists' errors so the
    script stays idempotent.
    """
    tuples: list[ClientTuple] = []
    for role, permissions in ROLE_PERMISSIONS.items():
        for permission in permissions:
            relation = RELATION_BY_PERMISSION[permission]
            tuples.append(
                ClientTuple(
                    user=f"role:{role}#member",
                    relation=relation,
                    object=PLATFORM_OBJECT,
                )
            )
    await _write_tuples_idempotent(client, tuples, label="role permission")


async def seed_admin_users(client: OpenFgaClient) -> None:
    """Assign platform_administrator membership to the bootstrap admin user."""
    if not INITIAL_ADMIN_USER:
        print("No bootstrap admin user to seed (INITIAL_ADMIN_USER not set).")
        return

    tuples = [
        ClientTuple(user=f"user:{INITIAL_ADMIN_USER}", relation="member", object="role:platform_administrator")
    ]
    await _write_tuples_idempotent(client, tuples, label="admin assignment")
    print(f"Seeded platform_administrator for: {INITIAL_ADMIN_USER}")


async def _write_tuples_idempotent(
    client: OpenFgaClient, tuples: list[ClientTuple], label: str
) -> None:
    written = 0
    for t in tuples:
        try:
            await client.write(ClientWriteRequest(writes=[t]))
            written += 1
        except Exception as e:
            # OpenFGA returns 400 write_failed_due_to_invalid_input when the
            # tuple already exists. Treat as idempotent success.
            if "already exists" in str(e) or "write_failed" in str(e):
                continue
            raise
    print(f"Wrote {written} new {label} tuple(s) ({len(tuples)} total).")


def write_store_id_file(store_id: str) -> None:
    os.makedirs(os.path.dirname(STORE_ID_FILE), exist_ok=True)
    with open(STORE_ID_FILE, "w", encoding="utf-8") as f:
        f.write(store_id)
    print(f"Wrote store ID to {STORE_ID_FILE}")


async def main() -> None:
    # First connect without a store to list/create it.
    config = ClientConfiguration(api_url=OPENFGA_URL)
    async with OpenFgaClient(config) as client:
        store_id = await find_or_create_store(client)
        client.set_store_id(store_id)

        await write_model_if_needed(client)
        await seed_role_tuples(client)
        await seed_admin_users(client)

    write_store_id_file(store_id)
    print("OpenFGA provisioning complete.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
