from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import require_permission
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.ai_provider_settings import AIProviderSetting
from ai_trust_persistence.models.platform_settings import PlatformSettings
from ai_trust_logging import get_logger

from app.schemas import AdminStatsResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/stats", tags=["stats"])

_USERS_BACKEND_URL = os.environ.get("USERS_BACKEND_URL", "http://users-backend:8008")


async def _get_users_count(username: str) -> int:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{_USERS_BACKEND_URL}/v1/users",
                params={"limit": 1},
                headers={"X-Forwarded-Preferred-Username": username},
            )
        if resp.status_code == 200:
            return resp.json().get("total", 0)
    except Exception as exc:
        logger.warning("admin.stats.users_fetch_failed", extra={"error": str(exc)})
    return 0


async def _get_roles_count(username: str) -> int:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            built_in_resp = await client.get(
                f"{_USERS_BACKEND_URL}/v1/roles",
                headers={"X-Forwarded-Preferred-Username": username},
            )
            custom_resp = await client.get(
                f"{_USERS_BACKEND_URL}/v1/iam/custom-roles",
                headers={"X-Forwarded-Preferred-Username": username},
            )
        count = 0
        if built_in_resp.status_code == 200:
            count += len(built_in_resp.json())
        if custom_resp.status_code == 200:
            count += len(custom_resp.json())
        return count
    except Exception as exc:
        logger.warning("admin.stats.roles_fetch_failed", extra={"error": str(exc)})
    return 0


@router.get("", response_model=AdminStatsResponse)
async def get_stats(username: str = Depends(require_permission(IAM_MANAGE))) -> AdminStatsResponse:
    async with SessionLocal() as session:
        ai_provider_count = await session.scalar(
            select(func.count(func.distinct(AIProviderSetting.provider))).where(
                AIProviderSetting.provider != "active"
            )
        ) or 0

        active_row = await session.scalar(
            select(AIProviderSetting).where(
                AIProviderSetting.provider == "active",
                AIProviderSetting.key == "provider",
            )
        )
        active_provider = active_row.value if active_row else None

        settings_row = await session.scalar(
            select(PlatformSettings).where(PlatformSettings.id == 1)
        )
        mail_configured = bool(settings_row and settings_row.smtp_host)

    user_count, role_count = await _get_users_count(username), await _get_roles_count(username)

    return AdminStatsResponse(
        user_count=user_count,
        role_count=role_count,
        ai_provider_count=ai_provider_count,
        active_provider=active_provider,
        mail_configured=mail_configured,
    )
