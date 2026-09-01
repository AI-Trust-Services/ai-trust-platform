"""Platform settings service with database lookup and env var fallback.

This service provides async access to platform settings with:
1. In-memory cache (60s TTL, per-tenant in multi-tenant mode)
2. Database lookup
3. Environment variable fallback (key "smtp.host" → SMTP_HOST)
4. Default value

Usage:
    from ai_trust_persistence.settings_service import get_setting, set_setting

    # Get a setting
    smtp_host = await get_setting("smtp.host", default="localhost")

    # Set a setting (requires session)
    await set_setting(session, "smtp.host", "mail.example.com", username="admin")
"""

from __future__ import annotations

import os
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence.models.platform_setting import PlatformSetting


def _get_tenant_id() -> str:
    """Get current tenant ID for cache keying. Returns 'default' in single-tenant mode."""
    try:
        from ai_trust_tenancy.context import tenant_id_var
        return tenant_id_var.get() or "default"
    except ImportError:
        # Tenancy lib not installed (e.g., in tests)
        return "default"


# Cache settings for 60 seconds, keyed by (tenant_id, key)
_cache: dict[tuple[str, str], tuple[Any, float]] = {}
_CACHE_TTL = 60.0


def _key_to_env_var(key: str) -> str:
    """Convert setting key to environment variable name.

    Examples:
        smtp.host → SMTP_HOST
        llm.provider → LLM_PROVIDER
        ai.client_id → AI_CLIENT_ID
    """
    return key.upper().replace(".", "_")


def invalidate_cache(key: str | None = None, tenant_id: str | None = None) -> None:
    """Invalidate cache for a specific key or all keys.

    Call this after updating settings to ensure changes take effect.

    Args:
        key: Specific setting key to invalidate, or None for all keys.
        tenant_id: Specific tenant to invalidate, or None for current tenant.
                   Pass "*" to invalidate all tenants.
    """
    global _cache

    if tenant_id == "*":
        # Invalidate all tenants
        if key is None:
            _cache.clear()
        else:
            _cache = {k: v for k, v in _cache.items() if k[1] != key}
    else:
        # Invalidate specific tenant (or current tenant if None)
        tid = tenant_id if tenant_id is not None else _get_tenant_id()
        if key is None:
            _cache = {k: v for k, v in _cache.items() if k[0] != tid}
        else:
            _cache.pop((tid, key), None)


async def get_setting(
    session: AsyncSession,
    key: str,
    default: Any = None,
    use_cache: bool = True,
) -> Any:
    """Get a platform setting value.

    Lookup order:
    1. In-memory cache (if not expired, per-tenant in multi-tenant mode)
    2. Database
    3. Environment variable
    4. Default value

    Args:
        session: Database session for queries
        key: Setting key (e.g., "smtp.host")
        default: Default value if not found anywhere
        use_cache: Whether to use cached value

    Returns:
        The setting value, or default if not found
    """
    tenant_id = _get_tenant_id()
    cache_key = (tenant_id, key)

    # Check cache first
    if use_cache and cache_key in _cache:
        value, timestamp = _cache[cache_key]
        if time.time() - timestamp < _CACHE_TTL:
            return value if value is not None else default

    # Query database
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == key)
    )
    setting = result.scalar_one_or_none()

    if setting is not None and setting.value is not None:
        # Cache and return database value
        _cache[cache_key] = (setting.value, time.time())
        return setting.value

    # Try environment variable
    env_var = _key_to_env_var(key)
    env_value = os.environ.get(env_var)

    if env_value is not None:
        # Parse env value based on expected type
        parsed_value = _parse_env_value(env_value, setting.value_type if setting else "string")
        _cache[cache_key] = (parsed_value, time.time())
        return parsed_value

    # Return default
    _cache[cache_key] = (default, time.time())
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
    invalidate_cache(key)

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
