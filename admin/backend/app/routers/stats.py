from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import select

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import require_permission
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.platform_settings import PlatformSettings
from ai_trust_logging import get_logger

from app.schemas import AdminStatsResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/stats", tags=["stats"])

_USERS_BACKEND_URL = os.environ.get("USERS_BACKEND_URL", "http://users-backend:8008")


async def _get_user_and_role_counts() -> tuple[int, int]:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{_USERS_BACKEND_URL}/internal/stats")
        if resp.status_code == 200:
            data = resp.json()
            return data.get("user_count", 0), data.get("role_count", 0)
    except Exception as exc:
        logger.warning("admin.stats.fetch_failed", extra={"error": str(exc)})
    return 0, 0


@router.get("", response_model=AdminStatsResponse)
async def get_stats(_: str = Depends(require_permission(IAM_MANAGE))) -> AdminStatsResponse:
    async with SessionLocal() as session:
        settings_row = await session.scalar(
            select(PlatformSettings).where(PlatformSettings.id == 1)
        )
        mail_configured = bool(settings_row and settings_row.smtp_host)

    user_count, role_count = await _get_user_and_role_counts()

    return AdminStatsResponse(
        user_count=user_count,
        role_count=role_count,
        mail_configured=mail_configured,
    )

