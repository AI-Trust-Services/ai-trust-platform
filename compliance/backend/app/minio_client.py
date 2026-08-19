"""MinIO client for evidence file storage.

The `minio` SDK is synchronous; all blocking calls are wrapped in
``asyncio.to_thread`` so they can be awaited from async request handlers without
blocking the event loop. Credentials are read from the environment (fail-fast).
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

# Bucket-per-tenant (physical isolation): each tenant's evidence lives in its OWN bucket
# `tenant-<org>`, resolved per-request from the tenant context. Guarded import keeps
# single-tenant/local working (the single shared bucket). TENANCY_MODE decides which path applies.
try:
    from ai_trust_tenancy import tenant_id_var
    from ai_trust_tenancy.config import MODE as _TENANCY_MODE
except ImportError:  # libs/tenancy not installed
    tenant_id_var = None
    _TENANCY_MODE = os.environ.get("TENANCY_MODE", "single").strip().lower()

logger = get_logger(__name__)

SINGLE_TENANT_BUCKET = "evidence-files"  # used only in TENANCY_MODE=single (and local dev)
# MinIO/S3 bucket names: lowercase, 3-63 chars, DNS-safe. tenant-<org> with '_'→'-'.
_SAFE_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

_client: Minio | None = None
_presign_client: Minio | None = None


def _current_tenant() -> str | None:
    return tenant_id_var.get() if tenant_id_var is not None else None


def bucket_name() -> str:
    """The MinIO bucket for the current request's tenant.

    jwt/header mode: `tenant-<org>` (physical per-tenant bucket). Fail-closed — if no tenant is
    resolved we REFUSE (raise) rather than fall back to a shared bucket, so evidence can never
    land in or be read from the wrong place. single mode: the shared `evidence-files` bucket.
    """
    if _TENANCY_MODE == "single":
        return SINGLE_TENANT_BUCKET
    tenant = _current_tenant()
    if not tenant:
        raise HTTPException(status_code=400, detail="No tenant in request context — cannot resolve evidence bucket.")
    name = "tenant-" + tenant.lower().replace("_", "-")
    if not _SAFE_BUCKET.match(name):
        raise HTTPException(status_code=400, detail="Tenant does not map to a valid bucket name.")
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
        # Explicit region avoids a GetBucketLocation network call at presign time —
        # the public endpoint is not reachable from inside the container, and
        # presigning must stay a purely local signing operation.
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
    """Create the current tenant's evidence bucket if it does not already exist (idempotent).
    (The operator also provisions it at tenant onboarding; this is a belt for first use.)"""
    await asyncio.to_thread(_ensure_bucket_sync, bucket_name())


def object_key(evidence_id: str, filename: str) -> str:
    """Deterministic, path-traversal-safe object key. With bucket-per-tenant the bucket already
    isolates tenants, so keys are the simple `evidence/{id}/{file}` layout (no tenant prefix).
    Downloads use the key stored on the evidence row, so pre-existing keys still resolve."""
    safe_name = os.path.basename(filename).replace("..", "").strip() or "file"
    return f"evidence/{evidence_id}/{safe_name}"


def _upload_sync(bucket: str, key: str, data: bytes, content_type: str) -> None:
    _get_client().put_object(
        bucket,
        key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type or "application/octet-stream",
    )


async def upload_file(evidence_id: str, filename: str, data: bytes, content_type: str) -> str:
    """Upload file bytes to the current tenant's bucket. Returns the stored object key."""
    bucket = bucket_name()
    key = object_key(evidence_id, filename)
    await asyncio.to_thread(_upload_sync, bucket, key, data, content_type)
    logger.info("minio.file_uploaded", extra={"bucket": bucket, "key": key, "size": len(data)})
    return key


def _presigned_sync(bucket: str, key: str, expires: timedelta) -> str:
    return _get_presign_client().presigned_get_object(bucket, key, expires=expires)


async def get_presigned_url(key: str, expires_hours: int = 1) -> str:
    """Return a presigned GET URL for the object in the current tenant's bucket."""
    return await asyncio.to_thread(_presigned_sync, bucket_name(), key, timedelta(hours=expires_hours))


def _delete_sync(bucket: str, key: str) -> None:
    _get_client().remove_object(bucket, key)


async def delete_file(key: str) -> None:
    """Delete an object from the current tenant's bucket. Best-effort — errors logged, not raised."""
    try:
        await asyncio.to_thread(_delete_sync, bucket_name(), key)
        logger.info("minio.file_deleted", extra={"key": key})
    except Exception as e:  # noqa: BLE001 — deletion is best-effort
        logger.warning("minio.file_delete_failed", extra={"key": key, "error": str(e)})
