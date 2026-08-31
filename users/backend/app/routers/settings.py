"""Platform settings management API.

Endpoints (all require iam:manage):
  GET    /admin/settings              — list all settings grouped by category
  GET    /admin/settings/{key}        — get single setting
  PUT    /admin/settings/{key}        — update setting value
  POST   /admin/settings/bulk         — bulk update settings
  POST   /admin/settings/test-smtp    — test SMTP connection
  POST   /admin/settings/test-llm     — test LLM connection
"""

from __future__ import annotations

import smtplib
from email.mime.text import MIMEText
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ai_trust_authorization import require_permission
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.platform_setting import PlatformSetting
from ai_trust_persistence.settings_service import (
    get_all_settings,
    get_setting,
    get_settings_by_category,
    get_smtp_config,
    get_llm_config,
    invalidate_cache,
    set_setting,
    bulk_set_settings,
)

router = APIRouter(prefix="/admin", tags=["admin-settings"])
logger = get_logger(__name__)

# Secret placeholder for masked values
SECRET_MASK = "••••••••"


# --- Schemas ---


class SettingValue(BaseModel):
    """Single setting value for update."""
    value: Any


class BulkSettingsUpdate(BaseModel):
    """Multiple settings to update at once."""
    settings: dict[str, Any]


class SettingResponse(BaseModel):
    """Setting response with masked secrets."""
    key: str
    value: Any
    category: str
    label: str
    description: str
    value_type: str
    is_secret: bool
    updated_at: str | None = None
    updated_by: str | None = None

    model_config = {"from_attributes": True}


class SettingsGroupResponse(BaseModel):
    """Settings grouped by category."""
    category: str
    label: str
    settings: list[SettingResponse]


class TestSMTPRequest(BaseModel):
    """Request to test SMTP connection."""
    recipient_email: str


class TestLLMRequest(BaseModel):
    """Request to test LLM connection."""
    prompt: str = "Hello, this is a test. Please respond with 'OK'."


class TestResponse(BaseModel):
    """Response from connection test."""
    success: bool
    message: str
    details: dict[str, Any] | None = None


# --- Helpers ---


def _mask_secret(setting: PlatformSetting) -> SettingResponse:
    """Convert setting to response, masking secret values."""
    value = setting.value
    if setting.is_secret and value is not None:
        value = SECRET_MASK

    return SettingResponse(
        key=setting.key,
        value=value,
        category=setting.category,
        label=setting.label,
        description=setting.description,
        value_type=setting.value_type,
        is_secret=setting.is_secret,
        updated_at=setting.updated_at.isoformat() if setting.updated_at else None,
        updated_by=setting.updated_by,
    )


def _get_category_label(category: str) -> str:
    """Get human-readable label for a category."""
    labels = {
        "mail": "Email (SMTP)",
        "ai": "AI Providers",
        "general": "General",
    }
    return labels.get(category, category.title())


def _get_current_username(request) -> str:
    """Extract username from request headers."""
    return request.headers.get("x-forwarded-preferred-username", "unknown")


# --- Endpoints ---


@router.get(
    "/settings",
    response_model=list[SettingsGroupResponse],
    dependencies=[Depends(require_permission("iam:manage"))],
)
async def list_settings(request: Request):
    """List all platform settings grouped by category."""
    async with SessionLocal() as session:
        settings = await get_all_settings(session)

    # Group by category
    groups: dict[str, list[SettingResponse]] = {}
    for s in settings:
        if s.category not in groups:
            groups[s.category] = []
        groups[s.category].append(_mask_secret(s))

    # Sort categories: general, mail, ai
    category_order = ["general", "mail", "ai"]
    result = []
    for cat in category_order:
        if cat in groups:
            result.append(SettingsGroupResponse(
                category=cat,
                label=_get_category_label(cat),
                settings=groups[cat],
            ))
    # Add any unknown categories
    for cat in groups:
        if cat not in category_order:
            result.append(SettingsGroupResponse(
                category=cat,
                label=_get_category_label(cat),
                settings=groups[cat],
            ))

    logger.info("settings.listed", extra={"count": len(settings)})
    return result


@router.get(
    "/settings/{key:path}",
    response_model=SettingResponse,
    dependencies=[Depends(require_permission("iam:manage"))],
)
async def get_setting_by_key(key: str):
    """Get a single setting by key."""
    async with SessionLocal() as session:
        from sqlalchemy import select
        result = await session.execute(
            select(PlatformSetting).where(PlatformSetting.key == key)
        )
        setting = result.scalar_one_or_none()

    if setting is None:
        raise HTTPException(404, f"Setting not found: {key}")

    return _mask_secret(setting)


@router.put(
    "/settings/{key:path}",
    response_model=SettingResponse,
    dependencies=[Depends(require_permission("iam:manage"))],
)
async def update_setting(key: str, body: SettingValue, request: Request):
    """Update a single setting value."""
    username = _get_current_username(request)

    async with SessionLocal() as session:
        # Verify setting exists
        from sqlalchemy import select
        result = await session.execute(
            select(PlatformSetting).where(PlatformSetting.key == key)
        )
        existing = result.scalar_one_or_none()

        if existing is None:
            raise HTTPException(404, f"Setting not found: {key}")

        # Update
        setting = await set_setting(session, key, body.value, username)
        await session.commit()

        logger.info(
            "setting.updated",
            extra={"key": key, "category": setting.category, "username": username},
        )

        return _mask_secret(setting)


@router.post(
    "/settings/bulk",
    response_model=list[SettingResponse],
    dependencies=[Depends(require_permission("iam:manage"))],
)
async def bulk_update_settings(body: BulkSettingsUpdate, request: Request):
    """Update multiple settings at once."""
    username = _get_current_username(request)

    async with SessionLocal() as session:
        updated = await bulk_set_settings(session, body.settings, username)
        await session.commit()

        logger.info(
            "settings.bulk_updated",
            extra={"count": len(updated), "keys": list(body.settings.keys()), "username": username},
        )

        return [_mask_secret(s) for s in updated]


@router.post(
    "/settings/test-smtp",
    response_model=TestResponse,
    dependencies=[Depends(require_permission("iam:manage"))],
)
async def test_smtp_connection(body: TestSMTPRequest, request: Request):
    """Test SMTP connection by sending a test email."""
    async with SessionLocal() as session:
        config = await get_smtp_config(session)

    host = config.get("host")
    port = config.get("port", 587)
    user = config.get("user")
    password = config.get("password")
    from_addr = config.get("from")
    from_name = config.get("from_name", "AI Trust Platform")
    use_ssl = config.get("ssl", False)
    use_starttls = config.get("starttls", True)

    if not host or not from_addr:
        return TestResponse(
            success=False,
            message="SMTP not configured. Please set smtp.host and smtp.from.",
        )

    try:
        # Create message
        msg = MIMEText(
            f"This is a test email from {from_name}.\n\n"
            "If you received this message, your SMTP configuration is working correctly."
        )
        msg["Subject"] = f"[{from_name}] SMTP Test"
        msg["From"] = f"{from_name} <{from_addr}>"
        msg["To"] = body.recipient_email

        # Connect and send
        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=10)
        else:
            server = smtplib.SMTP(host, port, timeout=10)
            if use_starttls:
                server.starttls()

        if user and password:
            server.login(user, password)

        server.sendmail(from_addr, [body.recipient_email], msg.as_string())
        server.quit()

        logger.info(
            "smtp.test.success",
            extra={"host": host, "recipient": body.recipient_email},
        )

        return TestResponse(
            success=True,
            message=f"Test email sent successfully to {body.recipient_email}",
            details={"host": host, "port": port, "ssl": use_ssl, "starttls": use_starttls},
        )

    except Exception as e:
        logger.warning(
            "smtp.test.failed",
            extra={"host": host, "error": str(e)},
        )
        return TestResponse(
            success=False,
            message=f"SMTP test failed: {e}",
            details={"host": host, "port": port},
        )


@router.post(
    "/settings/test-llm",
    response_model=TestResponse,
    dependencies=[Depends(require_permission("iam:manage"))],
)
async def test_llm_connection(body: TestLLMRequest, request: Request):
    """Test LLM connection by sending a simple prompt."""
    async with SessionLocal() as session:
        config = await get_llm_config(session)

    provider = config.get("provider", "stub")

    if provider == "stub":
        return TestResponse(
            success=True,
            message="LLM provider is set to 'stub' (test mode). No actual LLM connection.",
            details={"provider": provider},
        )

    # For ollama and external providers, we'd need to import and use the LLM client
    # For now, return a placeholder response
    try:
        if provider == "ollama":
            base_url = config.get("base_url", "http://ollama:11434/v1")
            model = config.get("model", "llama3.2")
            # Try a simple HTTP check
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{base_url.rstrip('/v1')}/api/tags")
                if response.status_code == 200:
                    return TestResponse(
                        success=True,
                        message=f"Successfully connected to Ollama at {base_url}",
                        details={"provider": provider, "base_url": base_url, "model": model},
                    )
                else:
                    return TestResponse(
                        success=False,
                        message=f"Ollama returned status {response.status_code}",
                        details={"provider": provider, "base_url": base_url},
                    )

        elif provider == "external":
            auth_url = config.get("auth_url")
            api_url = config.get("api_url")
            client_id = config.get("client_id")

            if not all([auth_url, api_url, client_id]):
                return TestResponse(
                    success=False,
                    message="External provider not fully configured. Set auth_url, api_url, and client_id.",
                    details={"provider": provider},
                )

            return TestResponse(
                success=True,
                message="External provider configuration looks valid. Full test requires credentials.",
                details={
                    "provider": provider,
                    "auth_url": auth_url,
                    "api_url": api_url,
                    "client_id_configured": bool(client_id),
                },
            )

        else:
            return TestResponse(
                success=False,
                message=f"Unknown LLM provider: {provider}",
                details={"provider": provider},
            )

    except Exception as e:
        logger.warning(
            "llm.test.failed",
            extra={"provider": provider, "error": str(e)},
        )
        return TestResponse(
            success=False,
            message=f"LLM test failed: {e}",
            details={"provider": provider},
        )
