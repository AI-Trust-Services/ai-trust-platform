"""Fire-and-forget email notifications via SMTP."""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass

import aiosmtplib
import httpx
from email.mime.text import MIMEText
from sqlalchemy import select

from ai_trust_logging import get_logger
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.platform_settings import PlatformSettings

logger = get_logger(__name__)

_USERS_BACKEND_URL = os.environ.get("USERS_BACKEND_URL", "http://users-backend:8008")

# Public link to the registry MFE, used in notification bodies. Derived from
# APP_PUBLIC_URL (the platform's public base URL) so mails point at the real
# deployment rather than a hardcoded localhost.
REGISTRY_URL = os.environ.get("APP_PUBLIC_URL", "http://localhost:8080").rstrip("/") + "/registry/"


@dataclass
class _SmtpConfig:
    enabled: bool
    host: str
    port: int
    user: str | None
    password: str | None
    from_addr: str
    from_name: str | None
    ssl: bool
    starttls: bool
    platform_name: str


async def _get_config() -> _SmtpConfig:
    try:
        async with SessionLocal() as session:
            row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
            if row and row.smtp_host:
                return _SmtpConfig(
                    enabled=True,
                    host=row.smtp_host,
                    port=row.smtp_port or 587,
                    user=row.smtp_user or None,
                    password=row.smtp_password or None,
                    from_addr=row.smtp_from or "",
                    from_name=row.smtp_from_name or None,
                    ssl=row.smtp_ssl,
                    starttls=row.smtp_starttls,
                    platform_name=row.platform_name,
                )
    except Exception as exc:
        logger.warning("notification.config_lookup_failed", extra={"error": str(exc)})
    return _SmtpConfig(
        enabled=False, host="", port=587, user=None, password=None,
        from_addr="", from_name=None, ssl=False, starttls=False,
        platform_name="AI Trust Platform",
    )


async def _get_email(username: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"{_USERS_BACKEND_URL}/internal/users/email-lookup",
                json={"username": username},
            )
            resp.raise_for_status()
            return resp.json().get("email")
    except Exception as exc:
        logger.warning("notification.email_lookup_failed", extra={"username": username, "error": str(exc)})
        return None


async def notify(to_username: str, subject: str, body: str) -> None:
    config, email = await asyncio.gather(
        _get_config(),
        _get_email(to_username),
    )

    if not config.enabled:
        logger.info("notification.skipped", extra={"username": to_username, "subject": subject,
                                                    "reason": "SMTP not configured"})
        return

    if not email:
        logger.warning("notification.no_email", extra={"username": to_username, "subject": subject})
        return

    resolved_subject = subject.format(platform_name=config.platform_name)
    resolved_body = body.format(platform_name=config.platform_name, registry_url=REGISTRY_URL)

    msg = MIMEText(resolved_body, "plain")
    msg["Subject"] = resolved_subject
    msg["From"] = f"{config.from_name} <{config.from_addr}>" if config.from_name else config.from_addr
    msg["To"] = email

    try:
        await aiosmtplib.send(
            msg,
            hostname=config.host,
            port=config.port,
            username=config.user,
            password=config.password,
            use_tls=config.ssl,
            start_tls=config.starttls,
        )
        logger.info("notification.sent", extra={"to": email, "subject": resolved_subject})
    except Exception as exc:
        logger.warning("notification.send_failed", extra={"to": email, "subject": resolved_subject, "error": str(exc)})


async def notify_question_assigned(
    assignee_username: str,
    system_name: str,
    system_id: str,
    question_label: str,
    assigned_by: str,
) -> None:
    """Notify a user that a specific questionnaire question has been assigned to them."""
    await notify(
        to_username=assignee_username,
        subject="[{platform_name}] Question assigned to you for '" + system_name + "'",
        body=(
            f"Hi,\n\n"
            f"{assigned_by} has asked you to answer a specific question for the AI system "
            f"'{system_name}' ({system_id}).\n\n"
            f"Question: {question_label}\n\n"
            "Please log in and open the system to provide your answer.\n\n"
            "{platform_name}: {registry_url}"
        ),
    )
