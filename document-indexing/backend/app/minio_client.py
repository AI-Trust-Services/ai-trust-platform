"""MinIO client for original document storage.

Mirrors ``compliance/backend/app/minio_client.py``: the sync ``minio`` SDK wrapped
in ``asyncio.to_thread``, two client singletons (internal for put/get, public for
presigning), bucket-per-tenant physical isolation with a fail-closed single-tenant
fallback. Adds ``download_file`` (the indexing worker reads the original back to parse it).
"""

from __future__ import annotations

import asyncio
import io
import os
import re
from datetime import timedelta

from fastapi import HTTPException
from minio import Minio

from ai_trust_logging import get_logger

try:
    from ai_trust_tenancy import tenant_id_var
    from ai_trust_tenancy.config import MODE as _TENANCY_MODE
except ImportError:  # libs/tenancy not installed
    tenant_id_var = None
    _TENANCY_MODE = os.environ.get("TENANCY_MODE", "single").strip().lower()

logger = get_logger(__name__)

SINGLE_TENANT_BUCKET = os.environ.get("INDEXING_BUCKET", "indexing-docs")
_SAFE_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

_client: Minio | None = None
_presign_client: Minio | None = None


def _current_tenant() -> str | None:
    return tenant_id_var.get() if tenant_id_var is not None else None


def bucket_name() -> str:
    """The MinIO bucket for the current request's tenant. Fail-closed in multi-tenant
    mode (never falls back to a shared bucket)."""
    if _TENANCY_MODE == "single":
        return SINGLE_TENANT_BUCKET
    tenant = _current_tenant()
    if not tenant:
        raise HTTPException(
            status_code=400,
            detail="No tenant in request context — cannot resolve document bucket.",
        )
    name = "tenant-" + tenant.lower().replace("_", "-")
    if not _SAFE_BUCKET.match(name):
        raise HTTPException(
            status_code=400, detail="Tenant does not map to a valid bucket name."
        )
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


def _get_presign_client() -> Minio:
    global _presign_client
    if _presign_client is None:
        _presign_client = Minio(
            os.environ["MINIO_PUBLIC_ENDPOINT"],
            access_key=os.environ["MINIO_ROOT_USER"],
            secret_key=os.environ["MINIO_ROOT_PASSWORD"],
            secure=os.environ["MINIO_SECURE"].lower() == "true",
            region=os.environ["MINIO_REGION"],
        )
    return _presign_client


def _ensure_bucket_sync(bucket: str) -> None:
    client = _get_client()
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
        logger.info("minio.bucket_created", extra={"bucket": bucket})


async def ensure_bucket() -> None:
    await asyncio.to_thread(_ensure_bucket_sync, bucket_name())


def object_key(document_id: str, version_id: str, filename: str) -> str:
    """Deterministic, path-traversal-safe key: ``documents/{doc}/{version}/{file}``."""
    safe_name = re.sub(r"[^\w.\-]", "_", os.path.basename(filename.replace("\\", "/")))
    safe_name = safe_name.strip(".")[:200] or "file"
    return f"documents/{document_id}/{version_id}/{safe_name}"


def _upload_sync(bucket: str, key: str, data: bytes, content_type: str) -> None:
    _get_client().put_object(
        bucket,
        key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type or "application/octet-stream",
    )


async def upload_file(
    document_id: str, version_id: str, filename: str, data: bytes, content_type: str
) -> str:
    """Upload file bytes to the current tenant's bucket. Returns the stored object key."""
    bucket = bucket_name()
    key = object_key(document_id, version_id, filename)
    await asyncio.to_thread(_upload_sync, bucket, key, data, content_type)
    logger.info(
        "minio.file_uploaded", extra={"bucket": bucket, "key": key, "size": len(data)}
    )
    return key


def _download_sync(bucket: str, key: str) -> bytes:
    resp = _get_client().get_object(bucket, key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


async def download_file(key: str) -> bytes:
    """Read an object's bytes from the current tenant's bucket (used by the worker)."""
    return await asyncio.to_thread(_download_sync, bucket_name(), key)


def _presigned_sync(bucket: str, key: str, expires: timedelta) -> str:
    return _get_presign_client().presigned_get_object(bucket, key, expires=expires)


async def get_presigned_url(key: str, expires_hours: int = 1) -> str:
    return await asyncio.to_thread(
        _presigned_sync, bucket_name(), key, timedelta(hours=expires_hours)
    )


def _delete_sync(bucket: str, key: str) -> None:
    _get_client().remove_object(bucket, key)


async def delete_file(key: str) -> None:
    """Delete an object. Best-effort — errors logged, not raised."""
    try:
        await asyncio.to_thread(_delete_sync, bucket_name(), key)
        logger.info("minio.file_deleted", extra={"key": key})
    except Exception as e:  # noqa: BLE001 — deletion is best-effort
        logger.warning("minio.file_delete_failed", extra={"key": key, "error": str(e)})
