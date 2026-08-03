"""OpenFGA client wrapper.

Reads OPENFGA_URL from the environment and the store ID from a file on the
shared `openfga-config` Docker volume (written by openfga-provision). Both are
resolved lazily on first use so that importing this module never fails at
import time — a backend that never calls a permission check still starts.
"""
import logging
import os

from openfga_sdk import ClientConfiguration, OpenFgaClient
from openfga_sdk.client.models import (
    ClientCheckRequest,
    ClientTuple,
    ClientWriteRequest,
)

log = logging.getLogger(__name__)

# Path on the shared volume where openfga-provision writes the store ID.
STORE_ID_FILE = os.environ.get("OPENFGA_STORE_ID_FILE", "/config/store_id")

_store_id: str | None = None


def _read_store_id() -> str:
    """Read the store ID from the shared volume (cached after first read)."""
    global _store_id
    if _store_id is not None:
        return _store_id

    # An explicit env var wins over the file — useful for tests / production
    # deployments that inject the store ID directly.
    env_id = os.environ.get("OPENFGA_STORE_ID", "").strip()
    if env_id:
        _store_id = env_id
        return _store_id

    try:
        with open(STORE_ID_FILE, "r", encoding="utf-8") as f:
            _store_id = f.read().strip()
    except FileNotFoundError as e:
        raise RuntimeError(
            f"OpenFGA store ID not found. Expected env OPENFGA_STORE_ID or file "
            f"{STORE_ID_FILE} (written by openfga-provision). Is the openfga-config "
            f"volume mounted and openfga-provision complete?"
        ) from e

    if not _store_id:
        raise RuntimeError(f"OpenFGA store ID file {STORE_ID_FILE} is empty.")
    return _store_id


def _configuration() -> ClientConfiguration:
    api_url = os.environ.get("OPENFGA_URL", "").strip()
    if not api_url:
        raise RuntimeError("OPENFGA_URL environment variable is not set or empty.")
    return ClientConfiguration(api_url=api_url, store_id=_read_store_id())


def get_client() -> OpenFgaClient:
    """Return a new OpenFgaClient. Caller must use it as an async context manager."""
    return OpenFgaClient(_configuration())


async def check(user: str, relation: str, obj: str) -> bool:
    """Run a single OpenFGA check. Returns True if allowed, False otherwise.

    Raises on connectivity/config errors — callers fail closed (see permissions.py).
    """
    async with get_client() as client:
        request = ClientCheckRequest(user=user, relation=relation, object=obj)
        response = await client.check(request)
        return bool(response.allowed)


async def list_allowed_relations(user: str, relations: list[str], obj: str) -> list[str]:
    """Return the subset of `relations` the user has on `obj` (batch check)."""
    from openfga_sdk.client.models import ClientListRelationsRequest

    async with get_client() as client:
        request = ClientListRelationsRequest(user=user, relations=relations, object=obj)
        # openfga_sdk 0.10.x returns a plain list of the allowed relation strings,
        # not an object with a `.relations` attribute.
        response = await client.list_relations(request)
        return list(response or [])


async def write_tuple(user: str, relation: str, obj: str) -> None:
    """Write a single tuple, ignoring 'already exists' for idempotency."""
    async with get_client() as client:
        try:
            await client.write(
                ClientWriteRequest(writes=[ClientTuple(user=user, relation=relation, object=obj)])
            )
        except Exception as e:
            if "already exists" in str(e) or "write_failed" in str(e):
                return
            raise


async def delete_tuple(user: str, relation: str, obj: str) -> None:
    """Delete a single tuple, ignoring 'not found' for idempotency."""
    async with get_client() as client:
        try:
            await client.write(
                ClientWriteRequest(deletes=[ClientTuple(user=user, relation=relation, object=obj)])
            )
        except Exception as e:
            if "not found" in str(e) or "cannot delete" in str(e):
                return
            raise


async def read_role_members(role_object: str) -> list[str]:
    """Return the user IDs (e.g. 'user:alice') that are members of a role object."""
    from openfga_sdk.models.read_request_tuple_key import ReadRequestTupleKey

    async with get_client() as client:
        body = ReadRequestTupleKey(relation="member", object=role_object)
        response = await client.read(body)
        return [t.key.user for t in (response.tuples or [])]


async def read_user_roles(user: str) -> list[str]:
    """Return the role objects (e.g. 'role:auditor') a user is a member of."""
    from openfga_sdk.models.read_request_tuple_key import ReadRequestTupleKey

    async with get_client() as client:
        # Read all member tuples for this user across role objects. OpenFGA's
        # read API requires an object *type* even when listing across all IDs —
        # `role:` (type prefix, empty id) filters to every role:* object.
        body = ReadRequestTupleKey(user=user, relation="member", object="role:")
        response = await client.read(body)
        return [t.key.object for t in (response.tuples or [])]
