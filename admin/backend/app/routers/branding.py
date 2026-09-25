"""Branding settings API — upload logos, set colors, preview and publish.

All endpoints require `iam:manage` permission. Tenant-aware: in jwt mode each
tenant has isolated branding stored in their schema (Postgres) and bucket (MinIO).

Branding is stored in a key-value table (`branding`) for flexibility — no migrations
needed for new fields. Each key has a `published` value (what users see) and a
`draft` value (for preview before publishing).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, Response, UploadFile
from sqlalchemy import select, update, delete

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import get_current_user, require_permission
from ai_trust_logging import get_logger
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.audit import log_audit_event
from ai_trust_persistence.models.branding import Branding
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

# Branding field names (all fields that can be set/published)
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
    "sidebar_text",
    "header_bg",
    "header_text",
    # Shell colors (dark mode)
    "sidebar_bg_dark",
    "sidebar_text_dark",
    "header_bg_dark",
    "header_text_dark",
    # UI element colors (light mode)
    "button_bg",
    "button_text",
    "table_header_bg",
    "table_border",
    "mfe_bg",
    # UI element colors (dark mode)
    "button_bg_dark",
    "button_text_dark",
    "table_header_bg_dark",
    "table_border_dark",
    "mfe_bg_dark",
]

# Logo fields that need MinIO copy from draft to published namespace
LOGO_FIELDS = ["logo_horizontal_light", "logo_horizontal_dark", "logo_icon", "favicon"]


async def _get_branding_dict() -> dict[str, tuple[str | None, str | None]]:
    """Fetch all branding entries as a dict of key -> (published, draft)."""
    async with SessionLocal() as session:
        result = await session.execute(select(Branding))
        entries = result.scalars().all()
        return {e.key: (e.published, e.draft) for e in entries}


async def _get_platform_name() -> str:
    """Get the platform name from platform_settings (used as org_name)."""
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        return row.platform_name if row else "AI Trust Platform"


def _get_value(entries: dict[str, tuple[str | None, str | None]], key: str, mode: str) -> str | None:
    """Get a branding value, falling back from draft to published in draft mode."""
    pub, draft = entries.get(key, (None, None))
    if mode == "draft":
        return draft if draft is not None else pub
    return pub


def _merge_advanced_colors(
    published: dict | None, draft: dict | None
) -> dict[str, str] | None:
    """Merge draft advanced colors over published, returning combined dict."""
    if not published and not draft:
        return None
    result = dict(published or {})
    if draft:
        result.update(draft)
    return result if result else None


def _build_response(
    entries: dict[str, tuple[str | None, str | None]],
    org_name: str,
    mode: Literal["published", "draft"],
) -> BrandingResponse:
    """Build BrandingResponse from branding entries dict."""
    # Parse advanced_colors from JSON string
    adv_pub_str, adv_draft_str = entries.get("advanced_colors", (None, None))
    adv_pub = json.loads(adv_pub_str) if adv_pub_str else None
    adv_draft = json.loads(adv_draft_str) if adv_draft_str else None

    # Get publish metadata
    pub_at, _ = entries.get("_published_at", (None, None))
    pub_by, _ = entries.get("_published_by", (None, None))

    if mode == "draft":
        return BrandingResponse(
            org_name=org_name,
            logo_horizontal_light=_get_value(entries, "logo_horizontal_light", mode),
            logo_horizontal_dark=_get_value(entries, "logo_horizontal_dark", mode),
            logo_icon=_get_value(entries, "logo_icon", mode),
            favicon=_get_value(entries, "favicon", mode),
            # Brand colors (light)
            primary_color=_get_value(entries, "primary_color", mode),
            secondary_color=_get_value(entries, "secondary_color", mode),
            accent_color=_get_value(entries, "accent_color", mode),
            warning_color=_get_value(entries, "warning_color", mode),
            # Brand colors (dark)
            primary_color_dark=_get_value(entries, "primary_color_dark", mode),
            secondary_color_dark=_get_value(entries, "secondary_color_dark", mode),
            accent_color_dark=_get_value(entries, "accent_color_dark", mode),
            warning_color_dark=_get_value(entries, "warning_color_dark", mode),
            # Shell colors (light)
            sidebar_bg=_get_value(entries, "sidebar_bg", mode),
            sidebar_text=_get_value(entries, "sidebar_text", mode),
            header_bg=_get_value(entries, "header_bg", mode),
            header_text=_get_value(entries, "header_text", mode),
            # Shell colors (dark)
            sidebar_bg_dark=_get_value(entries, "sidebar_bg_dark", mode),
            sidebar_text_dark=_get_value(entries, "sidebar_text_dark", mode),
            header_bg_dark=_get_value(entries, "header_bg_dark", mode),
            header_text_dark=_get_value(entries, "header_text_dark", mode),
            # UI element colors (light)
            button_bg=_get_value(entries, "button_bg", mode),
            button_text=_get_value(entries, "button_text", mode),
            table_header_bg=_get_value(entries, "table_header_bg", mode),
            table_border=_get_value(entries, "table_border", mode),
            mfe_bg=_get_value(entries, "mfe_bg", mode),
            # UI element colors (dark)
            button_bg_dark=_get_value(entries, "button_bg_dark", mode),
            button_text_dark=_get_value(entries, "button_text_dark", mode),
            table_header_bg_dark=_get_value(entries, "table_header_bg_dark", mode),
            table_border_dark=_get_value(entries, "table_border_dark", mode),
            mfe_bg_dark=_get_value(entries, "mfe_bg_dark", mode),
            # Advanced colors
            advanced_colors=_merge_advanced_colors(adv_pub, adv_draft),
            published_at=pub_at,
            published_by=pub_by,
        )
    # mode == "published"
    return BrandingResponse(
        org_name=org_name,
        logo_horizontal_light=_get_value(entries, "logo_horizontal_light", mode),
        logo_horizontal_dark=_get_value(entries, "logo_horizontal_dark", mode),
        logo_icon=_get_value(entries, "logo_icon", mode),
        favicon=_get_value(entries, "favicon", mode),
        # Brand colors (light)
        primary_color=_get_value(entries, "primary_color", mode),
        secondary_color=_get_value(entries, "secondary_color", mode),
        accent_color=_get_value(entries, "accent_color", mode),
        warning_color=_get_value(entries, "warning_color", mode),
        # Brand colors (dark)
        primary_color_dark=_get_value(entries, "primary_color_dark", mode),
        secondary_color_dark=_get_value(entries, "secondary_color_dark", mode),
        accent_color_dark=_get_value(entries, "accent_color_dark", mode),
        warning_color_dark=_get_value(entries, "warning_color_dark", mode),
        # Shell colors (light)
        sidebar_bg=_get_value(entries, "sidebar_bg", mode),
        sidebar_text=_get_value(entries, "sidebar_text", mode),
        header_bg=_get_value(entries, "header_bg", mode),
        header_text=_get_value(entries, "header_text", mode),
        # Shell colors (dark)
        sidebar_bg_dark=_get_value(entries, "sidebar_bg_dark", mode),
        sidebar_text_dark=_get_value(entries, "sidebar_text_dark", mode),
        header_bg_dark=_get_value(entries, "header_bg_dark", mode),
        header_text_dark=_get_value(entries, "header_text_dark", mode),
        # UI element colors (light)
        button_bg=_get_value(entries, "button_bg", mode),
        button_text=_get_value(entries, "button_text", mode),
        table_header_bg=_get_value(entries, "table_header_bg", mode),
        table_border=_get_value(entries, "table_border", mode),
        mfe_bg=_get_value(entries, "mfe_bg", mode),
        # UI element colors (dark)
        button_bg_dark=_get_value(entries, "button_bg_dark", mode),
        button_text_dark=_get_value(entries, "button_text_dark", mode),
        table_header_bg_dark=_get_value(entries, "table_header_bg_dark", mode),
        table_border_dark=_get_value(entries, "table_border_dark", mode),
        mfe_bg_dark=_get_value(entries, "mfe_bg_dark", mode),
        # Advanced colors
        advanced_colors=adv_pub,
        published_at=pub_at,
        published_by=pub_by,
    )


def _has_unpublished_changes(entries: dict[str, tuple[str | None, str | None]]) -> bool:
    """Check if any draft value differs from its published counterpart."""
    for key, (published, draft) in entries.items():
        if key.startswith("_"):
            continue  # Skip metadata keys
        if draft is not None and draft != published:
            return True
    return False


async def _upsert_branding(key: str, published: str | None = None, draft: str | None = None, set_draft: bool = True) -> None:
    """Insert or update a branding entry. If set_draft=True, updates draft; else updates published."""
    async with SessionLocal() as session:
        existing = await session.get(Branding, key)
        if existing:
            if set_draft:
                existing.draft = draft
            else:
                existing.published = published
        else:
            session.add(Branding(key=key, published=published, draft=draft if set_draft else None))
        await session.commit()


@router.get("", response_model=BrandingResponse)
async def get_branding(
    mode: Literal["published", "draft"] = Query("published", description="Which branding set to return"),
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingResponse:
    """Get branding configuration (published or draft for preview)."""
    entries = await _get_branding_dict()
    org_name = await _get_platform_name()
    return _build_response(entries, org_name, mode)


@router.put("", response_model=BrandingResponse)
async def update_branding(
    body: BrandingUpdate,
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingResponse:
    """Update draft branding values (colors only). Logo uploads use separate endpoint.

    Note: org_name/platform_name is configured in Settings, not here.
    """
    async with SessionLocal() as session:
        # Get all fields from the body that are not None
        updates: dict[str, str] = {}

        # Brand colors (light)
        if body.primary_color is not None:
            updates["primary_color"] = body.primary_color
        if body.secondary_color is not None:
            updates["secondary_color"] = body.secondary_color
        if body.accent_color is not None:
            updates["accent_color"] = body.accent_color
        if body.warning_color is not None:
            updates["warning_color"] = body.warning_color
        # Brand colors (dark)
        if body.primary_color_dark is not None:
            updates["primary_color_dark"] = body.primary_color_dark
        if body.secondary_color_dark is not None:
            updates["secondary_color_dark"] = body.secondary_color_dark
        if body.accent_color_dark is not None:
            updates["accent_color_dark"] = body.accent_color_dark
        if body.warning_color_dark is not None:
            updates["warning_color_dark"] = body.warning_color_dark
        # Shell colors (light)
        if body.sidebar_bg is not None:
            updates["sidebar_bg"] = body.sidebar_bg
        if body.sidebar_text is not None:
            updates["sidebar_text"] = body.sidebar_text
        if body.header_bg is not None:
            updates["header_bg"] = body.header_bg
        if body.header_text is not None:
            updates["header_text"] = body.header_text
        # Shell colors (dark)
        if body.sidebar_bg_dark is not None:
            updates["sidebar_bg_dark"] = body.sidebar_bg_dark
        if body.sidebar_text_dark is not None:
            updates["sidebar_text_dark"] = body.sidebar_text_dark
        if body.header_bg_dark is not None:
            updates["header_bg_dark"] = body.header_bg_dark
        if body.header_text_dark is not None:
            updates["header_text_dark"] = body.header_text_dark
        # UI element colors (light)
        if body.button_bg is not None:
            updates["button_bg"] = body.button_bg
        if body.button_text is not None:
            updates["button_text"] = body.button_text
        if body.table_header_bg is not None:
            updates["table_header_bg"] = body.table_header_bg
        if body.table_border is not None:
            updates["table_border"] = body.table_border
        if body.mfe_bg is not None:
            updates["mfe_bg"] = body.mfe_bg
        # UI element colors (dark)
        if body.button_bg_dark is not None:
            updates["button_bg_dark"] = body.button_bg_dark
        if body.button_text_dark is not None:
            updates["button_text_dark"] = body.button_text_dark
        if body.table_header_bg_dark is not None:
            updates["table_header_bg_dark"] = body.table_header_bg_dark
        if body.table_border_dark is not None:
            updates["table_border_dark"] = body.table_border_dark
        if body.mfe_bg_dark is not None:
            updates["mfe_bg_dark"] = body.mfe_bg_dark

        # Upsert each field
        for key, value in updates.items():
            existing = await session.get(Branding, key)
            if existing:
                existing.draft = value
            else:
                session.add(Branding(key=key, published=None, draft=value))

        # Advanced colors (merge into existing draft)
        if body.advanced_colors is not None:
            existing_adv = await session.get(Branding, "advanced_colors")
            if existing_adv:
                # Parse existing draft, merge, serialize back
                existing_dict = json.loads(existing_adv.draft) if existing_adv.draft else {}
                existing_dict.update(body.advanced_colors)
                existing_adv.draft = json.dumps(existing_dict)
            else:
                session.add(Branding(key="advanced_colors", published=None, draft=json.dumps(body.advanced_colors)))

        await session.commit()
        logger.info("branding.draft_updated")

    entries = await _get_branding_dict()
    org_name = await _get_platform_name()
    return _build_response(entries, org_name, "draft")


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

    # Update draft in branding table
    async with SessionLocal() as session:
        existing = await session.get(Branding, asset_type)
        if existing:
            existing.draft = key
        else:
            session.add(Branding(key=asset_type, published=None, draft=key))
        await session.commit()
        logger.info("branding.logo_uploaded", extra={"asset_type": asset_type, "key": key})

    entries = await _get_branding_dict()
    org_name = await _get_platform_name()
    return _build_response(entries, org_name, "draft")


@router.post("/publish", response_model=BrandingPublishResponse)
async def publish_branding(
    username: str = Depends(get_current_user),
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingPublishResponse:
    """Publish all draft branding changes to live."""
    now = datetime.now(timezone.utc)

    async with SessionLocal() as session:
        # Get all branding entries with drafts
        result = await session.execute(select(Branding).where(Branding.draft.isnot(None)))
        entries_with_drafts = result.scalars().all()

        for entry in entries_with_drafts:
            if entry.key.startswith("_"):
                continue  # Skip metadata keys

            draft_value = entry.draft
            # For logo fields, copy the file from draft namespace to published namespace
            if entry.key in LOGO_FIELDS and draft_value and "/draft/" in draft_value:
                published_key = await branding_storage.copy_draft_to_published(draft_value)
                entry.published = published_key
            else:
                entry.published = draft_value
            entry.draft = None  # Clear draft after publish

        # Update publish metadata
        pub_at = await session.get(Branding, "_published_at")
        if pub_at:
            pub_at.published = now.isoformat()
        else:
            session.add(Branding(key="_published_at", published=now.isoformat(), draft=None))

        pub_by = await session.get(Branding, "_published_by")
        if pub_by:
            pub_by.published = username
        else:
            session.add(Branding(key="_published_by", published=username, draft=None))

        # Audit log
        log_audit_event(
            session,
            actor=username,
            action="branding.published",
            resource_type="platform_settings",
            resource_id="branding",
            changes={"published_by": username},
        )

        await session.commit()
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
        # Clear all draft fields (set to None)
        await session.execute(update(Branding).values(draft=None))
        await session.commit()
        logger.info("branding.draft_discarded")

    entries = await _get_branding_dict()
    org_name = await _get_platform_name()
    return _build_response(entries, org_name, "published")


@router.get("/status", response_model=BrandingStatusResponse)
async def get_branding_status(
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingStatusResponse:
    """Check if there are unpublished branding changes."""
    entries = await _get_branding_dict()
    pub_at, _ = entries.get("_published_at", (None, None))
    pub_by, _ = entries.get("_published_by", (None, None))
    return BrandingStatusResponse(
        has_unpublished_changes=_has_unpublished_changes(entries),
        published_at=pub_at,
        published_by=pub_by,
    )


@router.post("/reset", response_model=BrandingResponse)
async def reset_branding(
    username: str = Depends(get_current_user),
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> BrandingResponse:
    """Reset all branding to platform defaults. Clears all published and draft values."""
    now = datetime.now(timezone.utc)

    async with SessionLocal() as session:
        # Delete all branding entries except metadata (keys starting with _)
        await session.execute(delete(Branding).where(~Branding.key.like("\\_%")))

        # Update publish metadata
        pub_at = await session.get(Branding, "_published_at")
        if pub_at:
            pub_at.published = now.isoformat()
        else:
            session.add(Branding(key="_published_at", published=now.isoformat(), draft=None))

        pub_by = await session.get(Branding, "_published_by")
        if pub_by:
            pub_by.published = username
        else:
            session.add(Branding(key="_published_by", published=username, draft=None))

        # Audit log
        log_audit_event(
            session,
            actor=username,
            action="branding.reset",
            resource_type="platform_settings",
            resource_id="branding",
            changes={"reset_by": username},
        )

        await session.commit()
        logger.info("branding.reset_to_defaults", extra={"reset_by": username})

    entries = await _get_branding_dict()
    org_name = await _get_platform_name()
    return _build_response(entries, org_name, "published")


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
async def get_public_branding() -> BrandingResponse:
    """Get published branding for shell/MFEs. No authentication required.

    Always returns published values only — draft preview is handled via the
    authenticated `/branding?mode=draft` endpoint for admin preview iframes.
    """
    entries = await _get_branding_dict()
    org_name = await _get_platform_name()
    return _build_response(entries, org_name, "published")


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
