"""Seed platform_settings from env vars on first startup.

If no row exists in the DB, insert one using the current env var values.
If a row already exists, leave it untouched — the DB is the source of truth
after the first deployment.
"""
from __future__ import annotations

import os

from sqlalchemy import select

from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.platform_settings import PlatformSettings
from ai_trust_logging import get_logger

logger = get_logger(__name__)


async def seed_settings_from_env() -> None:
    async with SessionLocal() as session:
        existing = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if existing is not None:
            logger.info("admin.settings.seed_skipped", extra={"reason": "row already exists"})
            return

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
