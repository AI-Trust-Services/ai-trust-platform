"""Seed platform_settings and ai_provider_settings from env vars on first startup.

If no row/rows exist in the DB, insert them using the current env var values.
If rows already exist, leave them untouched — the DB is the source of truth
after the first deployment.
"""
from __future__ import annotations

import os

from sqlalchemy import func, select

from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.ai_provider_settings import AIProviderSetting
from ai_trust_persistence.models.platform_settings import PlatformSettings
from ai_trust_logging import get_logger

logger = get_logger(__name__)


async def seed_settings_from_env() -> None:
    async with SessionLocal() as session:
        existing = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if existing is not None:
            logger.info("admin.settings.seed_skipped", extra={"reason": "row already exists"})
        else:
            smtp_port_raw = os.environ.get("SMTP_PORT", "").strip()
            row = PlatformSettings(
                id=1,
                platform_name=os.environ.get("PLATFORM_NAME", "AI Trust Platform").strip() or "AI Trust Platform",
                support_email=os.environ.get("SUPPORT_EMAIL", "").strip() or None,
                smtp_host=os.environ.get("SMTP_HOST", "").strip() or None,
                smtp_port=int(smtp_port_raw) if smtp_port_raw.isdigit() else None,
                smtp_user=os.environ.get("SMTP_USER", "").strip() or None,
                smtp_password=os.environ.get("SMTP_PASSWORD", "").strip() or None,
                smtp_from=os.environ.get("SMTP_FROM", "").strip() or None,
                smtp_from_name=os.environ.get("SMTP_FROM_NAME", "").strip() or None,
                smtp_ssl=os.environ.get("SMTP_SSL", "false").lower() == "true",
                smtp_starttls=os.environ.get("SMTP_STARTTLS", "false").lower() == "true",
            )
            session.add(row)
            await session.commit()
            logger.info("admin.settings.seeded", extra={"smtp_enabled": bool(row.smtp_host)})

        ai_count = await session.scalar(select(func.count()).select_from(AIProviderSetting))
        if ai_count:
            logger.info("admin.ai_provider.seed_skipped", extra={"reason": "rows already exist"})
            return

        active_provider = os.environ.get("LLM_PROVIDER", "stub").strip() or "stub"
        rows: list[AIProviderSetting] = [
            AIProviderSetting(provider="active", key="provider", value=active_provider, is_secret=False),
            # Ollama settings
            AIProviderSetting(provider="ollama", key="llm_base_url",
                              value=os.environ.get("LLM_BASE_URL", "http://ollama:11434/v1").strip() or None,
                              is_secret=False),
            AIProviderSetting(provider="ollama", key="llm_model",
                              value=os.environ.get("LLM_MODEL", "llama3.2").strip() or None,
                              is_secret=False),
            AIProviderSetting(provider="ollama", key="llm_vision_model",
                              value=os.environ.get("LLM_VISION_MODEL", "llama3.2-vision").strip() or None,
                              is_secret=False),
            AIProviderSetting(provider="ollama", key="llm_api_key",
                              value=os.environ.get("LLM_API_KEY", "ollama").strip() or None,
                              is_secret=True),
            # External provider settings
            AIProviderSetting(provider="external", key="ai_client_id",
                              value=os.environ.get("AI_CLIENT_ID", "").strip() or None,
                              is_secret=False),
            AIProviderSetting(provider="external", key="ai_client_secret",
                              value=os.environ.get("AI_CLIENT_SECRET", "").strip() or None,
                              is_secret=True),
            AIProviderSetting(provider="external", key="ai_auth_url",
                              value=os.environ.get("AI_AUTH_URL", "").strip() or None,
                              is_secret=False),
            AIProviderSetting(provider="external", key="ai_api_url",
                              value=os.environ.get("AI_API_URL", "").strip() or None,
                              is_secret=False),
            AIProviderSetting(provider="external", key="ai_resource_group",
                              value=os.environ.get("AI_RESOURCE_GROUP", "default").strip() or "default",
                              is_secret=False),
            AIProviderSetting(provider="external", key="ai_deployment_id",
                              value=os.environ.get("AI_DEPLOYMENT_ID", "").strip() or None,
                              is_secret=False),
            AIProviderSetting(provider="external", key="ai_api_version",
                              value=os.environ.get("AI_API_VERSION", "bedrock-2023-05-31").strip() or "bedrock-2023-05-31",
                              is_secret=False),
        ]
        session.add_all(rows)
        await session.commit()
        logger.info("admin.ai_provider.seeded", extra={"active_provider": active_provider})
