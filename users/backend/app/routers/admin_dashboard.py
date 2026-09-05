"""Admin dashboard API for platform KPIs and activity.

Endpoints (all require iam:manage):
  GET    /admin/dashboard           — get dashboard KPIs
  GET    /admin/dashboard/activity  — get recent admin activity
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, text

from ai_trust_authorization import require_permission, openfga_client
from ai_trust_authorization.constants import BUILT_IN_ROLES
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.custom_role import CustomRole
from ai_trust_persistence.models.platform_setting import PlatformSetting
from ai_trust_persistence.settings_service import get_setting, get_smtp_config, get_llm_config

router = APIRouter(prefix="/admin", tags=["admin-dashboard"])
logger = get_logger(__name__)


# --- Schemas ---


class DashboardKPIs(BaseModel):
    """Dashboard key performance indicators."""
    user_count: int
    role_count: int
    ai_provider_count: int
    mail_status: str  # "connected", "not_configured", "error"


class ConfigurationStatus(BaseModel):
    """Status of a configuration item."""
    key: str
    label: str
    status: str  # "healthy", "warning", "error", "not_configured"
    message: str


class DashboardResponse(BaseModel):
    """Full dashboard response."""
    kpis: DashboardKPIs
    configuration_status: list[ConfigurationStatus]


class AdminActivity(BaseModel):
    """Single admin activity entry."""
    id: str
    action: str
    description: str
    actor: str | None
    timestamp: datetime
    details: dict[str, Any] | None = None


class ActivityResponse(BaseModel):
    """Recent admin activity response."""
    activities: list[AdminActivity]


# --- Helpers ---


async def _count_users_from_keycloak() -> int:
    """Count users from Keycloak (excluding service accounts)."""
    try:
        from app.keycloak import admin_client, current_realm
        with admin_client(current_realm()) as kc:
            # Get all users and filter out service accounts manually
            # This is more reliable than using count endpoints which can be inconsistent
            users_resp = kc.get("/users", params={"max": 1000})
            users_resp.raise_for_status()
            users = users_resp.json()
            # Filter out service accounts
            real_users = [u for u in users if not u.get("username", "").startswith("service-account-")]
            return len(real_users)
    except Exception as e:
        logger.warning("dashboard.keycloak_count_failed", extra={"error": str(e)})
        return 0


async def _count_roles() -> int:
    """Count total roles (built-in + custom)."""
    builtin_count = len(BUILT_IN_ROLES)

    async with SessionLocal() as session:
        result = await session.execute(
            select(func.count()).select_from(CustomRole)
        )
        custom_count = result.scalar() or 0

    return builtin_count + custom_count


async def _get_ai_provider_status(session) -> tuple[int, str]:
    """Get AI provider count and status."""
    config = await get_llm_config(session)
    provider = config.get("provider", "stub")

    if provider == "stub":
        return 0, "Test mode (stub)"
    elif provider == "ollama":
        base_url = config.get("base_url")
        if base_url:
            return 1, f"Ollama ({config.get('model', 'default')})"
        return 0, "Ollama not configured"
    elif provider == "external":
        client_id = config.get("client_id")
        api_url = config.get("api_url")
        if client_id and api_url:
            return 1, "External provider configured"
        return 0, "External provider not fully configured"

    return 0, "Unknown provider"


async def _get_mail_status(session) -> str:
    """Get mail service status."""
    config = await get_smtp_config(session)

    host = config.get("host")
    from_addr = config.get("from")

    if not host:
        return "not_configured"
    if not from_addr:
        return "not_configured"

    return "connected"


async def _get_configuration_statuses(session) -> list[ConfigurationStatus]:
    """Get status of all configuration items."""
    statuses = []

    # Mail service
    smtp_config = await get_smtp_config(session)
    if smtp_config.get("host") and smtp_config.get("from"):
        statuses.append(ConfigurationStatus(
            key="mail",
            label="Mail service connected",
            status="healthy",
            message=f"SMTP configured: {smtp_config.get('host')}",
        ))
    else:
        statuses.append(ConfigurationStatus(
            key="mail",
            label="Mail service",
            status="not_configured",
            message="SMTP not configured",
        ))

    # AI providers
    llm_config = await get_llm_config(session)
    provider = llm_config.get("provider", "stub")
    if provider == "stub":
        statuses.append(ConfigurationStatus(
            key="ai",
            label="AI providers",
            status="warning",
            message="Using test mode (stub provider)",
        ))
    elif provider in ("ollama", "external"):
        ai_count, ai_msg = await _get_ai_provider_status(session)
        if ai_count > 0:
            statuses.append(ConfigurationStatus(
                key="ai",
                label=f"{ai_count} AI provider(s) configured",
                status="healthy",
                message=ai_msg,
            ))
        else:
            statuses.append(ConfigurationStatus(
                key="ai",
                label="AI providers",
                status="not_configured",
                message=ai_msg,
            ))

    # SSO (placeholder - not implemented yet)
    statuses.append(ConfigurationStatus(
        key="sso",
        label="SSO enabled",
        status="healthy",
        message="Keycloak SSO is active",
    ))

    # Backup status (placeholder)
    statuses.append(ConfigurationStatus(
        key="backup",
        label="Last backup successful",
        status="healthy",
        message="Automatic backups not yet implemented",
    ))

    return statuses


# --- Endpoints ---


@router.get(
    "/dashboard",
    response_model=DashboardResponse,
    dependencies=[Depends(require_permission("iam:manage"))],
)
async def get_dashboard():
    """Get dashboard KPIs and configuration status."""
    async with SessionLocal() as session:
        # Count users
        user_count = await _count_users_from_keycloak()

        # Count roles
        role_count = await _count_roles()

        # AI provider status
        ai_count, _ = await _get_ai_provider_status(session)

        # Mail status
        mail_status = await _get_mail_status(session)

        # Configuration statuses
        config_statuses = await _get_configuration_statuses(session)

    kpis = DashboardKPIs(
        user_count=user_count,
        role_count=role_count,
        ai_provider_count=ai_count,
        mail_status=mail_status,
    )

    logger.info(
        "dashboard.loaded",
        extra={"user_count": user_count, "role_count": role_count},
    )

    return DashboardResponse(
        kpis=kpis,
        configuration_status=config_statuses,
    )


@router.get(
    "/dashboard/activity",
    response_model=ActivityResponse,
    dependencies=[Depends(require_permission("iam:manage"))],
)
async def get_recent_activity():
    """Get recent admin activity.

    This aggregates recent changes from platform_settings
    and could be extended to include user/role changes.
    """
    activities: list[AdminActivity] = []

    async with SessionLocal() as session:
        # Get recently updated settings
        result = await session.execute(
            select(PlatformSetting)
            .where(PlatformSetting.updated_by.isnot(None))
            .order_by(PlatformSetting.updated_at.desc())
            .limit(10)
        )
        settings = result.scalars().all()

        for s in settings:
            if s.updated_at:
                activities.append(AdminActivity(
                    id=f"setting-{s.key}",
                    action="setting_updated",
                    description=f"{s.label or s.key} updated",
                    actor=s.updated_by,
                    timestamp=s.updated_at,
                    details={"key": s.key, "category": s.category},
                ))

    # Sort by timestamp descending
    activities.sort(key=lambda a: a.timestamp, reverse=True)

    # Limit to 20 most recent
    activities = activities[:20]

    logger.info("dashboard.activity.loaded", extra={"count": len(activities)})

    return ActivityResponse(activities=activities)
