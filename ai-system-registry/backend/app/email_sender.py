"""Fire-and-forget email notifications via SMTP."""
from __future__ import annotations

import os

import aiosmtplib
import httpx
from email.mime.text import MIMEText

from ai_trust_logging import get_logger

logger = get_logger(__name__)

# Email notifications are OPTIONAL. When SMTP_HOST is unset the whole feature is
# disabled (notify() becomes a no-op) instead of crashing the service at import.
# This lets the registry backend run in deployments that don't configure SMTP
# (e.g. a bare single-tenant install) without a hard dependency on a mail server.
# To ENABLE email, set SMTP_HOST (+ SMTP_PORT, SMTP_FROM, SMTP_SSL, SMTP_STARTTLS).
_SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
_EMAIL_ENABLED = bool(_SMTP_HOST)
_SMTP_PORT = int(os.environ.get("SMTP_PORT", "0") or "0")
_SMTP_USER = os.environ.get("SMTP_USER", "")
_SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
_SMTP_FROM = os.environ.get("SMTP_FROM", "")
_SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME")
_SMTP_SSL = os.environ.get("SMTP_SSL", "false").lower() == "true"
_SMTP_STARTTLS = os.environ.get("SMTP_STARTTLS", "false").lower() == "true"
_USERS_BACKEND_URL = os.environ.get("USERS_BACKEND_URL", "http://users-backend:8008")

if not _EMAIL_ENABLED:
    logger.info(
        "notification.disabled",
        extra={"reason": "SMTP_HOST not set — email notifications are disabled"},
    )

# Public link to the registry MFE, used in notification bodies. Derived from
# APP_PUBLIC_URL (the platform's public base URL) so mails point at the real
# deployment rather than a hardcoded localhost.
REGISTRY_URL = os.environ.get("APP_PUBLIC_URL", "http://localhost:8080").rstrip("/") + "/registry/"


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
    if not _EMAIL_ENABLED:
        # Email disabled (no SMTP_HOST configured) — nothing to do. Registration
        # and every other flow still succeed; the notification is simply skipped.
        logger.info("notification.skipped", extra={"username": to_username, "subject": subject})
        return

    email = await _get_email(to_username)
    if not email:
        logger.warning("notification.no_email", extra={"username": to_username, "subject": subject})
        return

    msg = MIMEText(body, "plain")
    msg["Subject"] = subject
    msg["From"] = f"{_SMTP_FROM_NAME} <{_SMTP_FROM}>" if _SMTP_FROM_NAME else _SMTP_FROM
    msg["To"] = email

    try:
        await aiosmtplib.send(
            msg,
            hostname=_SMTP_HOST,
            port=_SMTP_PORT,
            username=_SMTP_USER or None,
            password=_SMTP_PASSWORD or None,
            use_tls=_SMTP_SSL,
            start_tls=_SMTP_STARTTLS,
        )
        logger.info("notification.sent", extra={"to": email, "subject": subject})
    except Exception as exc:
        logger.warning("notification.send_failed", extra={"to": email, "subject": subject, "error": str(exc)})
