from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import require_permission
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.platform_settings import PlatformSettings
from ai_trust_logging import get_logger

from app.schemas import GeneralSettingsResponse, GeneralSettingsUpdate

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/settings", tags=["settings"])


@router.get("", response_model=GeneralSettingsResponse)
async def get_settings(_: str = Depends(require_permission(IAM_MANAGE))) -> GeneralSettingsResponse:
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")
        return GeneralSettingsResponse.model_validate(row)


@router.put("", response_model=GeneralSettingsResponse)
async def update_settings(
    body: GeneralSettingsUpdate,
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> GeneralSettingsResponse:
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")

        if body.platform_name is not None:
            row.platform_name = body.platform_name
        if body.support_email is not None:
            row.support_email = body.support_email or None

        await session.commit()
        await session.refresh(row)
        logger.info("admin.settings.updated")

    return GeneralSettingsResponse.model_validate(row)
