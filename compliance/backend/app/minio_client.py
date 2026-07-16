"""MinIO client for evidence file storage.

The `minio` SDK is synchronous; all blocking calls are wrapped in
``asyncio.to_thread`` so they can be awaited from async request handlers without
blocking the event loop. Credentials are read from the environment (fail-fast).
"""
from __future__ import annotations

import asyncio
import io
import os
from datetime import timedelta

from minio import Minio

from ai_trust_logging import get_logger

logger = get_logger(__name__)

EVIDENCE_BUCKET = "evidence-files"

_client: Minio | None = None
_presign_client: Minio | None = None


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


def _ensure_bucket_sync() -> None:
    client = _get_client()
    if not client.bucket_exists(EVIDENCE_BUCKET):
        client.make_bucket(EVIDENCE_BUCKET)
        logger.info("minio.bucket_created", extra={"bucket": EVIDENCE_BUCKET})


async def ensure_bucket() -> None:
    """Create the evidence bucket if it does not already exist (idempotent)."""
    await asyncio.to_thread(_ensure_bucket_sync)


def object_key(evidence_id: str, filename: str) -> str:
    """Deterministic, path-traversal-safe object key for an evidence file."""
    safe_name = os.path.basename(filename).replace("..", "").strip() or "file"
    return f"evidence/{evidence_id}/{safe_name}"


def _upload_sync(key: str, data: bytes, content_type: str) -> None:
    _get_client().put_object(
        EVIDENCE_BUCKET,
        key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type or "application/octet-stream",
    )


async def upload_file(evidence_id: str, filename: str, data: bytes, content_type: str) -> str:
    """Upload file bytes to MinIO. Returns the stored object key."""
    key = object_key(evidence_id, filename)
    await asyncio.to_thread(_upload_sync, key, data, content_type)
    logger.info("minio.file_uploaded", extra={"key": key, "size": len(data)})
    return key


def _presigned_sync(key: str, expires: timedelta) -> str:
    return _get_presign_client().presigned_get_object(EVIDENCE_BUCKET, key, expires=expires)


async def get_presigned_url(key: str, expires_hours: int = 1) -> str:
    """Return a presigned GET URL for the object, valid for `expires_hours`."""
    return await asyncio.to_thread(_presigned_sync, key, timedelta(hours=expires_hours))


def _delete_sync(key: str) -> None:
    _get_client().remove_object(EVIDENCE_BUCKET, key)


async def delete_file(key: str) -> None:
    """Delete an object from MinIO. Best-effort — errors are logged, not raised."""
    try:
        await asyncio.to_thread(_delete_sync, key)
        logger.info("minio.file_deleted", extra={"key": key})
    except Exception as e:  # noqa: BLE001 — deletion is best-effort
        logger.warning("minio.file_delete_failed", extra={"key": key, "error": str(e)})
