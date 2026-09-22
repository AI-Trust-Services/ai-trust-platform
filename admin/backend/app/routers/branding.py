"""Branding settings API — upload logos, set colors, preview and publish.

All endpoints require `iam:manage` permission. Tenant-aware: in jwt mode each
tenant has isolated branding stored in their schema (Postgres) and bucket (MinIO).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, Response, UploadFile
from sqlalchemy import select

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import get_current_user, require_permission
from ai_trust_logging import get_logger
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.platform_settings import PlatformSettings

from app import branding_storage
from app.schemas import (
    BrandingPublishResponse,
    BrandingResponse,
    BrandingStatusResponse,
    BrandingUpdate,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/branding", tags=["branding"])

# Branding field names (published columns, _draft variants generated from these)
# Note: org_name is now derived from platform_name, not a separate field
BRANDING_FIELDS = [
    "logo_horizontal_light",
    "logo_horizontal_dark",
    "logo_icon",
    "favicon",
    # Brand colors (light mode)
    "primary_color",
    "secondary_color",
    "accent_color",
    "warning_color",
    # Brand colors (dark mode)
    "primary_color_dark",
    "secondary_color_dark",
    "accent_color_dark",
    "warning_color_dark",
    # Shell colors (light mode)
    "sidebar_bg",
    "header_bg",
    # Shell colors (dark mode)
    "sidebar_bg_dark",
    "header_bg_dark",
    # UI element colors (light mode)
    "button_bg",
    "button_text",
    "table_header_bg",
    "table_border",
    # UI element colors (dark mode)
    "button_bg_dark",
    "button_text_dark",
    "table_header_bg_dark",
    "table_border_dark",
]


async def _get_settings() -> PlatformSettings:
    """Fetch the singleton settings row, scoped to the current tenant."""
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")
        return row


def _build_response(row: PlatformSettings, mode: Literal["published", "draft"]) -> BrandingResponse:
    """Build BrandingResponse from either published or draft columns.

    Note: org_name is always derived from platform_name (configured in Settings).
    """
    # org_name comes from platform_name in Settings (not a separate branding field)
    org_name = row.platform_name

    if mode == "draft":
        return BrandingResponse(
            org_name=org_name,
            logo_horizontal_light=row.logo_horizontal_light_draft or row.logo_horizontal_light,
            logo_horizontal_dark=row.logo_horizontal_dark_draft or row.logo_horizontal_dark,
            logo_icon=row.logo_icon_draft or row.logo_icon,
            favicon=row.favicon_draft or row.favicon,
            # Brand colors (light)
            primary_color=row.primary_color_draft or row.primary_color,
            secondary_color=row.secondary_color_draft or row.secondary_color,
            accent_color=row.accent_color_draft or row.accent_color,
            warning_color=row.warning_color_draft or row.warning_color,
            # Brand colors (dark)
            primary_color_dark=row.primary_color_dark_draft or row.primary_color_dark,
            secondary_color_dark=row.secondary_color_dark_draft or row.secondary_color_dark,
            accent_color_dark=row.accent_color_dark_draft or row.accent_color_dark,
            warning_color_dark=row.warning_color_dark_draft or row.warning_color_dark,
            # Shell colors (light)
            sidebar_bg=row.sidebar_bg_draft or row.sidebar_bg,
            header_bg=row.header_bg_draft or row.header_bg,
            # Shell colors (dark)
            sidebar_bg_dark=row.sidebar_bg_dark_draft or row.sidebar_bg_dark,
            header_bg_dark=row.header_bg_dark_draft or row.header_bg_dark,
            # UI element colors (light)
            button_bg=row.button_bg_draft or row.button_bg,
            button_text=row.button_text_draft or row.button_text,
            table_header_bg=row.table_header_bg_draft or row.table_header_bg,
            table_border=row.table_border_draft or row.table_border,
            # UI element colors (dark)
            button_bg_dark=row.button_bg_dark_draft or row.button_bg_dark,
            button_text_dark=row.button_text_dark_draft or row.button_text_dark,
            table_header_bg_dark=row.table_header_bg_dark_draft or row.table_header_bg_dark,
            table_border_dark=row.table_border_dark_draft or row.table_border_dark,
            published_at=row.branding_published_at.isoformat() if row.branding_published_at else None,
            published_by=row.branding_published_by,
        )
    # mode == "published"
    return BrandingResponse(
        org_name=org_name,
        logo_horizontal_light=row.logo_horizontal_light,
        logo_horizontal_dark=row.logo_horizontal_dark,
        logo_icon=row.logo_icon,
        favicon=row.favicon,
        # Brand colors (light)
        primary_color=row.primary_color,
        secondary_color=row.secondary_color,
        accent_color=row.accent_color,
        warning_color=row.warning_color,
        # Brand colors (dark)
        primary_color_dark=row.primary_color_dark,
        secondary_color_dark=row.secondary_color_dark,
        accent_color_dark=row.accent_color_dark,
        warning_color_dark=row.warning_color_dark,
        # Shell colors (light)
        sidebar_bg=row.sidebar_bg,
        header_bg=row.header_bg,
        # Shell colors (dark)
        sidebar_bg_dark=row.sidebar_bg_dark,
        header_bg_dark=row.header_bg_dark,
        # UI element colors (light)
        button_bg=row.button_bg,
        button_text=row.button_text,
        table_header_bg=row.table_header_bg,
        table_border=row.table_border,
        # UI element colors (dark)
        button_bg_dark=row.button_bg_dark,
        button_text_dark=row.button_text_dark,
        table_header_bg_dark=row.table_header_bg_dark,
        table_border_dark=row.table_border_dark,
        published_at=row.branding_published_at.isoformat() if row.branding_published_at else None,
        published_by=row.branding_published_by,
    )


def _has_unpublished_changes(row: PlatformSettings) -> bool:
    """Check if any draft value differs from its published counterpart."""
    for field in BRANDING_FIELDS:
        published = getattr(row, field)
        draft = getattr(row, f"{field}_draft")
        if draft is not None and draft != published:
            return True
    return False


@router.get("", response_model=BrandingResponse)
async def get_branding(
    mode: Literal["published", "draft"] = Query("published", description="Which branding set to return"),
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingResponse:
    """Get branding configuration (published or draft for preview)."""
    row = await _get_settings()
    return _build_response(row, mode)


@router.put("", response_model=BrandingResponse)
async def update_branding(
    body: BrandingUpdate,
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingResponse:
    """Update draft branding values (colors only). Logo uploads use separate endpoint.

    Note: org_name/platform_name is configured in Settings, not here.
    """
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")

        # Brand colors (light)
        if body.primary_color is not None:
            row.primary_color_draft = body.primary_color
        if body.secondary_color is not None:
            row.secondary_color_draft = body.secondary_color
        if body.accent_color is not None:
            row.accent_color_draft = body.accent_color
        if body.warning_color is not None:
            row.warning_color_draft = body.warning_color
        # Brand colors (dark)
        if body.primary_color_dark is not None:
            row.primary_color_dark_draft = body.primary_color_dark
        if body.secondary_color_dark is not None:
            row.secondary_color_dark_draft = body.secondary_color_dark
        if body.accent_color_dark is not None:
            row.accent_color_dark_draft = body.accent_color_dark
        if body.warning_color_dark is not None:
            row.warning_color_dark_draft = body.warning_color_dark
        # Shell colors (light)
        if body.sidebar_bg is not None:
            row.sidebar_bg_draft = body.sidebar_bg
        if body.header_bg is not None:
            row.header_bg_draft = body.header_bg
        # Shell colors (dark)
        if body.sidebar_bg_dark is not None:
            row.sidebar_bg_dark_draft = body.sidebar_bg_dark
        if body.header_bg_dark is not None:
            row.header_bg_dark_draft = body.header_bg_dark
        # UI element colors (light)
        if body.button_bg is not None:
            row.button_bg_draft = body.button_bg
        if body.button_text is not None:
            row.button_text_draft = body.button_text
        if body.table_header_bg is not None:
            row.table_header_bg_draft = body.table_header_bg
        if body.table_border is not None:
            row.table_border_draft = body.table_border
        # UI element colors (dark)
        if body.button_bg_dark is not None:
            row.button_bg_dark_draft = body.button_bg_dark
        if body.button_text_dark is not None:
            row.button_text_dark_draft = body.button_text_dark
        if body.table_header_bg_dark is not None:
            row.table_header_bg_dark_draft = body.table_header_bg_dark
        if body.table_border_dark is not None:
            row.table_border_dark_draft = body.table_border_dark

        await session.commit()
        await session.refresh(row)
        logger.info("branding.draft_updated")

    return _build_response(row, "draft")


@router.post("/upload/{asset_type}", response_model=BrandingResponse)
async def upload_logo(
    asset_type: str = Path(
        ...,
        description="Asset type: logo_horizontal_light, logo_horizontal_dark, logo_icon, favicon",
    ),
    file: UploadFile = File(...),
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingResponse:
    """Upload a logo or favicon. Stored in draft until published."""
    # Validate asset type and file
    branding_storage.validate_upload(
        asset_type,
        file.content_type or "application/octet-stream",
        file.size or 0,
    )

    # Read file data
    data = await file.read()
    if len(data) > branding_storage.MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large")

    # Upload to MinIO
    key = await branding_storage.upload_file(
        asset_type,
        file.filename or "file",
        data,
        file.content_type or "application/octet-stream",
    )

    # Update draft column with the storage key
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")

        draft_field = f"{asset_type}_draft"
        setattr(row, draft_field, key)

        await session.commit()
        await session.refresh(row)
        logger.info("branding.logo_uploaded", extra={"asset_type": asset_type, "key": key})

    return _build_response(row, "draft")


@router.post("/publish", response_model=BrandingPublishResponse)
async def publish_branding(
    username: str = Depends(get_current_user),
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingPublishResponse:
    """Publish all draft branding changes to live."""
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")

        # Copy all draft values to published (only where draft differs)
        for field in BRANDING_FIELDS:
            draft_value = getattr(row, f"{field}_draft")
            if draft_value is not None:
                setattr(row, field, draft_value)
                setattr(row, f"{field}_draft", None)  # Clear draft after publish

        # Update publish metadata
        now = datetime.now(timezone.utc)
        row.branding_published_at = now
        row.branding_published_by = username

        await session.commit()
        await session.refresh(row)
        logger.info("branding.published", extra={"published_by": username})

    return BrandingPublishResponse(
        success=True,
        published_at=now.isoformat(),
        published_by=username,
    )


@router.post("/discard", response_model=BrandingResponse)
async def discard_branding(
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingResponse:
    """Discard all draft changes and reset to published values."""
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")

        # Clear all draft fields
        for field in BRANDING_FIELDS:
            setattr(row, f"{field}_draft", None)

        await session.commit()
        await session.refresh(row)
        logger.info("branding.draft_discarded")

    return _build_response(row, "published")


@router.get("/status", response_model=BrandingStatusResponse)
async def get_branding_status(
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingStatusResponse:
    """Check if there are unpublished branding changes."""
    row = await _get_settings()
    return BrandingStatusResponse(
        has_unpublished_changes=_has_unpublished_changes(row),
        published_at=row.branding_published_at.isoformat() if row.branding_published_at else None,
        published_by=row.branding_published_by,
    )


@router.post("/reset", response_model=BrandingResponse)
async def reset_branding(
    username: str = Depends(get_current_user),
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingResponse:
    """Reset all branding to platform defaults. Clears all published and draft values."""
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")

        # Reset all branding fields to defaults/null
        row.logo_horizontal_light = None
        row.logo_horizontal_dark = None
        row.logo_icon = None
        row.favicon = None
        # Brand colors (light)
        row.primary_color = None
        row.secondary_color = None
        row.accent_color = None
        row.warning_color = None
        # Brand colors (dark)
        row.primary_color_dark = None
        row.secondary_color_dark = None
        row.accent_color_dark = None
        row.warning_color_dark = None
        # Shell colors
        row.sidebar_bg = None
        row.header_bg = None
        row.sidebar_bg_dark = None
        row.header_bg_dark = None
        # UI element colors
        row.button_bg = None
        row.button_text = None
        row.table_header_bg = None
        row.table_border = None
        row.button_bg_dark = None
        row.button_text_dark = None
        row.table_header_bg_dark = None
        row.table_border_dark = None

        # Clear all draft fields
        for field in BRANDING_FIELDS:
            setattr(row, f"{field}_draft", None)

        # Update publish metadata
        now = datetime.now(timezone.utc)
        row.branding_published_at = now
        row.branding_published_by = username

        await session.commit()
        await session.refresh(row)
        logger.info("branding.reset_to_defaults", extra={"reset_by": username})

    return _build_response(row, "published")


@router.get("/asset/{asset_key:path}")
async def get_asset(
    asset_key: str = Path(..., description="Full asset key (e.g., branding/logo_icon/icon.svg)"),
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> Response:
    """Serve a branding asset from storage. Used for preview and by the shell."""
    data, content_type = await branding_storage.get_file(asset_key)
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ── Public endpoint for shell/MFEs (no auth required) ──────────────────────────


@router.get("/public", response_model=BrandingResponse)
async def get_public_branding(
    preview: bool = Query(False, description="If true, return draft branding for preview mode"),
) -> BrandingResponse:
    """Get published branding for shell/MFEs. No authentication required.

    In preview mode (?preview=true), returns draft values merged over published.
    """
    row = await _get_settings()
    mode: Literal["published", "draft"] = "draft" if preview else "published"
    return _build_response(row, mode)


@router.get("/public/asset/{asset_key:path}")
async def get_public_asset(
    asset_key: str = Path(..., description="Full asset key (e.g., branding/logo_icon/icon.svg)"),
) -> Response:
    """Serve a branding asset publicly. Used by shell to render logos.

    Note: In production, you may want to serve these through a CDN or nginx directly.
    """
    data, content_type = await branding_storage.get_file(asset_key)
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )
