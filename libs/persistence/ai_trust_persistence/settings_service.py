"""Platform settings service with database lookup and env var fallback.

This service provides async access to platform settings with:
1. Database lookup
2. Environment variable fallback (key "smtp.host" → SMTP_HOST)
3. Default value

Usage:
    from ai_trust_persistence.settings_service import get_setting, set_setting

    # Get a setting
    smtp_host = await get_setting("smtp.host", default="localhost")

    # Set a setting (requires session)
    await set_setting(session, "smtp.host", "mail.example.com", username="admin")
"""

from __future__ import annotations

import os
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence.models.platform_setting import PlatformSetting


def _key_to_env_var(key: str) -> str:
    """Convert setting key to environment variable name.

    Examples:
        smtp.host → SMTP_HOST
        llm.provider → LLM_PROVIDER
        ai.client_id → AI_CLIENT_ID
    """
    return key.upper().replace(".", "_")


async def get_setting(
    session: AsyncSession,
    key: str,
    default: Any = None,
) -> Any:
    """Get a platform setting value.

    Lookup order:
    1. Database
    2. Environment variable
    3. Default value
    """
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == key)
    )
    setting = result.scalar_one_or_none()

    if setting is not None and setting.value is not None:
        return setting.value

    env_var = _key_to_env_var(key)
    env_value = os.environ.get(env_var)

    if env_value is not None:
        return _parse_env_value(env_value, setting.value_type if setting else "string")

    return default


def _parse_env_value(value: str, value_type: str) -> Any:
    """Parse environment variable string to appropriate type."""
    if value_type == "boolean":
        return value.lower() in ("true", "1", "yes", "on")
    elif value_type == "number":
        try:
            return int(value)
        except ValueError:
            try:
                return float(value)
            except ValueError:
                return value
    else:
        return value


async def get_settings_by_category(
    session: AsyncSession,
    category: str,
) -> list[PlatformSetting]:
    """Get all settings in a category.

    Args:
        session: Database session
        category: Category name (e.g., "mail", "ai", "general")

    Returns:
        List of PlatformSetting objects
    """
    result = await session.execute(
        select(PlatformSetting)
        .where(PlatformSetting.category == category)
        .order_by(PlatformSetting.key)
    )
    return list(result.scalars().all())


async def get_all_settings(session: AsyncSession) -> list[PlatformSetting]:
    """Get all platform settings.

    Args:
        session: Database session

    Returns:
        List of all PlatformSetting objects
    """
    result = await session.execute(
        select(PlatformSetting).order_by(PlatformSetting.category, PlatformSetting.key)
    )
    return list(result.scalars().all())


async def set_setting(
    session: AsyncSession,
    key: str,
    value: Any,
    username: str | None = None,
) -> PlatformSetting:
    """Set a platform setting value.

    Creates the setting if it doesn't exist, updates if it does.
    Invalidates cache for this key.

    Args:
        session: Database session
        key: Setting key
        value: New value
        username: Username making the change (for audit)

    Returns:
        Updated PlatformSetting object
    """
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == key)
    )
    setting = result.scalar_one_or_none()

    if setting is None:
        # Create new setting (shouldn't happen normally - all settings are seeded)
        category = key.split(".")[0] if "." in key else "general"
        setting = PlatformSetting(
            key=key,
            value=value,
            category=category,
            updated_by=username,
        )
        session.add(setting)
    else:
        setting.value = value
        setting.updated_by = username

    await session.flush()
    return setting


async def bulk_set_settings(
    session: AsyncSession,
    settings: dict[str, Any],
    username: str | None = None,
) -> list[PlatformSetting]:
    """Set multiple settings at once.

    Args:
        session: Database session
        settings: Dict of key -> value pairs
        username: Username making the change

    Returns:
        List of updated PlatformSetting objects
    """
    updated = []
    for key, value in settings.items():
        setting = await set_setting(session, key, value, username)
        updated.append(setting)
    return updated


# Convenience functions for common settings

async def get_smtp_config(session: AsyncSession) -> dict[str, Any]:
    """Get all SMTP configuration as a dict."""
    settings = await get_settings_by_category(session, "mail")
    config = {}
    for s in settings:
        # Strip category prefix: smtp.host -> host
        short_key = s.key.split(".", 1)[-1] if "." in s.key else s.key
        config[short_key] = s.value

        # Also try env var fallback
        if s.value is None:
            env_var = _key_to_env_var(s.key)
            env_value = os.environ.get(env_var)
            if env_value is not None:
                config[short_key] = _parse_env_value(env_value, s.value_type)

    return config


async def get_llm_config(session: AsyncSession) -> dict[str, Any]:
    """Get all LLM/AI configuration as a dict."""
    settings = await get_settings_by_category(session, "ai")
    config = {}
    for s in settings:
        short_key = s.key.split(".", 1)[-1] if "." in s.key else s.key
        config[short_key] = s.value

        # Also try env var fallback
        if s.value is None:
            env_var = _key_to_env_var(s.key)
            env_value = os.environ.get(env_var)
            if env_value is not None:
                config[short_key] = _parse_env_value(env_value, s.value_type)

    return config
