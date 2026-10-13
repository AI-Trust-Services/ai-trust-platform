"""MinIO access for the indexing worker (download originals to parse).

Standalone copy of the backend's MinIO helper without the FastAPI dependency — the
worker is a plain asyncio process. Single-tenant resolves to the shared bucket; the
per-tenant path mirrors the backend for when the worker runs a multi-tenant pass.
"""

from __future__ import annotations

import asyncio
import os
import re

from minio import Minio

from ai_trust_logging import get_logger

try:
    from ai_trust_tenancy import tenant_id_var
    from ai_trust_tenancy.config import MODE as _TENANCY_MODE
except ImportError:
    tenant_id_var = None
    _TENANCY_MODE = os.environ.get("TENANCY_MODE", "single").strip().lower()

logger = get_logger(__name__)

SINGLE_TENANT_BUCKET = os.environ.get("INDEXING_BUCKET", "indexing-docs")
_SAFE_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

_client: Minio | None = None


def _current_tenant() -> str | None:
    return tenant_id_var.get() if tenant_id_var is not None else None


def bucket_name() -> str:
    if _TENANCY_MODE == "single":
        return SINGLE_TENANT_BUCKET
    tenant = _current_tenant()
    if not tenant:
        raise RuntimeError("No tenant in context — cannot resolve document bucket.")
    name = "tenant-" + tenant.lower().replace("_", "-")
    if not _SAFE_BUCKET.match(name):
        raise RuntimeError("Tenant does not map to a valid bucket name.")
    return name


def _get_client() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            os.environ["MINIO_ENDPOINT"],
            access_key=os.environ["MINIO_ROOT_USER"],
            secret_key=os.environ["MINIO_ROOT_PASSWORD"],
            secure=os.environ["MINIO_SECURE"].lower() == "true",
        )
    return _client


def _download_sync(bucket: str, key: str) -> bytes:
    resp = _get_client().get_object(bucket, key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


async def download_file(key: str) -> bytes:
    return await asyncio.to_thread(_download_sync, bucket_name(), key)
