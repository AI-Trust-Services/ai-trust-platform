"""MinIO client for branding asset storage.

Tenant-aware bucket routing: single mode uses a shared `branding-assets` bucket,
jwt mode uses the tenant's bucket (`tenant-<org>`) with a `branding/` key prefix.

The `minio` SDK is synchronous; all blocking calls are wrapped in
``asyncio.to_thread`` so they can be awaited from async request handlers.
"""
from __future__ import annotations

import asyncio
import io
import os
import re
from datetime import timedelta

from fastapi import HTTPException
from minio import Minio
from minio.error import S3Error

from ai_trust_logging import get_logger

# Tenant-aware bucket routing (same pattern as compliance/minio_client.py)
try:
    from ai_trust_tenancy import tenant_id_var
    from ai_trust_tenancy.config import MODE as _TENANCY_MODE
except ImportError:
    tenant_id_var = None
    _TENANCY_MODE = os.environ.get("TENANCY_MODE", "single").strip().lower()

logger = get_logger(__name__)

SINGLE_TENANT_BUCKET = "branding-assets"
_SAFE_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

# Allowed asset types and their content types
ALLOWED_ASSET_TYPES = {
    "logo_horizontal_light",
    "logo_horizontal_dark",
    "logo_icon",
    "favicon",
}
ALLOWED_CONTENT_TYPES = {
    "image/svg+xml",
    "image/png",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "image/jpeg",
}
MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB

_client: Minio | None = None
_presign_client: Minio | None = None


def _current_tenant() -> str | None:
    return tenant_id_var.get() if tenant_id_var is not None else None


def bucket_name() -> str:
    """The MinIO bucket for the current request's tenant.

    single mode: shared `branding-assets` bucket.
    jwt mode: `tenant-<org>` bucket (same bucket as evidence, different key prefix).
    """
    if _TENANCY_MODE == "single":
        return SINGLE_TENANT_BUCKET
    tenant = _current_tenant()
    if not tenant:
        raise HTTPException(status_code=400, detail="No tenant in request context — cannot resolve branding bucket.")
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
            secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
        )
    return _client


def _get_presign_client() -> Minio:
    global _presign_client
    if _presign_client is None:
        _presign_client = Minio(
            os.environ["MINIO_PUBLIC_ENDPOINT"],
            access_key=os.environ["MINIO_ROOT_USER"],
            secret_key=os.environ["MINIO_ROOT_PASSWORD"],
            secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
            region=os.environ.get("MINIO_REGION", "us-east-1"),
        )
    return _presign_client


def _ensure_bucket_sync(bucket: str) -> None:
    client = _get_client()
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
        logger.info("minio.bucket_created", extra={"bucket": bucket})


async def ensure_bucket() -> None:
    """Create the branding bucket if it does not exist (idempotent)."""
    await asyncio.to_thread(_ensure_bucket_sync, bucket_name())


def object_key(asset_type: str, filename: str, *, draft: bool = False) -> str:
    """Deterministic, path-traversal-safe object key for branding assets.

    Key format: `branding/{asset_type}/{safe_filename}` (published)
             or `branding/{asset_type}/draft/{safe_filename}` (draft)

    Draft uploads use a separate namespace so they cannot overwrite live assets.
    On publish, the draft key is copied to the published key.
    """
    safe_name = os.path.basename(filename).replace("..", "").strip() or "file"
    # Limit filename length
    if len(safe_name) > 100:
        safe_name = safe_name[:100]
    if draft:
        return f"branding/{asset_type}/draft/{safe_name}"
    return f"branding/{asset_type}/{safe_name}"


def validate_upload(asset_type: str, content_type: str, size: int) -> None:
    """Validate upload parameters. Raises HTTPException on invalid input."""
    if asset_type not in ALLOWED_ASSET_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid asset type '{asset_type}'. Allowed: {', '.join(sorted(ALLOWED_ASSET_TYPES))}",
        )
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid content type '{content_type}'. Allowed: SVG, PNG, ICO, JPEG",
        )
    if size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({size} bytes). Maximum allowed: {MAX_FILE_SIZE} bytes (2MB)",
        )


def _upload_sync(bucket: str, key: str, data: bytes, content_type: str) -> None:
    _get_client().put_object(
        bucket,
        key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type or "application/octet-stream",
    )


async def upload_file(asset_type: str, filename: str, data: bytes, content_type: str, *, draft: bool = True) -> str:
    """Upload branding asset to the tenant's bucket. Returns the stored object key.

    By default uploads to the draft namespace (draft=True) so live assets are not overwritten.
    On publish, call copy_draft_to_published() to promote the draft asset.
    """
    bucket = bucket_name()
    await ensure_bucket()
    key = object_key(asset_type, filename, draft=draft)
    await asyncio.to_thread(_upload_sync, bucket, key, data, content_type)
    logger.info("branding.file_uploaded", extra={"bucket": bucket, "key": key, "size": len(data), "draft": draft})
    return key


def _get_file_sync(bucket: str, key: str) -> tuple[bytes, str]:
    """Fetch file bytes and content type from MinIO."""
    client = _get_client()
    response = client.get_object(bucket, key)
    try:
        data = response.read()
        content_type = response.headers.get("Content-Type", "application/octet-stream")
        return data, content_type
    finally:
        response.close()
        response.release_conn()


async def get_file(key: str) -> tuple[bytes, str]:
    """Fetch branding asset from the tenant's bucket. Returns (data, content_type)."""
    try:
        return await asyncio.to_thread(_get_file_sync, bucket_name(), key)
    except S3Error as e:
        if e.code == "NoSuchKey":
            raise HTTPException(status_code=404, detail="Asset not found")
        raise HTTPException(status_code=500, detail=f"Storage error: {e}")


def _presigned_sync(bucket: str, key: str, expires: timedelta) -> str:
    return _get_presign_client().presigned_get_object(bucket, key, expires=expires)


async def get_presigned_url(key: str, expires_hours: int = 24) -> str:
    """Return a presigned GET URL for a branding asset in the tenant's bucket."""
    return await asyncio.to_thread(_presigned_sync, bucket_name(), key, timedelta(hours=expires_hours))


def _delete_sync(bucket: str, key: str) -> None:
    _get_client().remove_object(bucket, key)


async def delete_file(key: str) -> None:
    """Delete a branding asset from the tenant's bucket. Best-effort — errors logged, not raised."""
    try:
        await asyncio.to_thread(_delete_sync, bucket_name(), key)
        logger.info("branding.file_deleted", extra={"key": key})
    except Exception as e:  # noqa: BLE001 — deletion is best-effort
        logger.warning("branding.file_delete_failed", extra={"key": key, "error": str(e)})


def _copy_sync(bucket: str, src_key: str, dst_key: str) -> None:
    """Copy an object within the same bucket."""
    from minio.commonconfig import CopySource

    _get_client().copy_object(
        bucket,
        dst_key,
        CopySource(bucket, src_key),
    )


async def copy_draft_to_published(draft_key: str) -> str:
    """Copy a draft asset to its published location. Returns the published key.

    Draft key format: branding/{asset_type}/draft/{filename}
    Published key format: branding/{asset_type}/{filename}
    """
    # Parse the draft key to derive the published key
    # branding/logo_icon/draft/icon.svg -> branding/logo_icon/icon.svg
    parts = draft_key.split("/")
    if len(parts) >= 4 and parts[2] == "draft":
        published_key = f"{parts[0]}/{parts[1]}/{'/'.join(parts[3:])}"
    else:
        # Already a published key or unexpected format — just use as-is
        published_key = draft_key

    bucket = bucket_name()
    try:
        await asyncio.to_thread(_copy_sync, bucket, draft_key, published_key)
        logger.info("branding.draft_promoted", extra={"draft_key": draft_key, "published_key": published_key})
        return published_key
    except Exception as e:
        logger.error("branding.draft_promote_failed", extra={"draft_key": draft_key, "error": str(e)})
        raise HTTPException(status_code=500, detail=f"Failed to publish asset: {e}") from e
