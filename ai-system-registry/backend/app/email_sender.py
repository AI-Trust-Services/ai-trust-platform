"""Fire-and-forget email notifications via SMTP."""
from __future__ import annotations

import os

import aiosmtplib
import httpx
from email.mime.text import MIMEText

from ai_trust_logging import get_logger

logger = get_logger(__name__)

_SMTP_HOST = os.environ.get("SMTP_HOST", "mailpit")
_SMTP_PORT = int(os.environ.get("SMTP_PORT", "1025"))
_SMTP_USER = os.environ.get("SMTP_USER", "")
_SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
_SMTP_FROM = os.environ.get("SMTP_FROM", "noreply@ai-trust.local")
_USERS_BACKEND_URL = os.environ.get("USERS_BACKEND_URL", "http://users-backend:8001")


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
    email = await _get_email(to_username)
    if not email:
        logger.warning("notification.no_email", extra={"username": to_username, "subject": subject})
        return

    msg = MIMEText(body, "plain")
    msg["Subject"] = subject
    msg["From"] = _SMTP_FROM
    msg["To"] = email

    try:
        await aiosmtplib.send(
            msg,
            hostname=_SMTP_HOST,
            port=_SMTP_PORT,
            username=_SMTP_USER or None,
            password=_SMTP_PASSWORD or None,
            start_tls=False,
        )
        logger.info("notification.sent", extra={"to": email, "subject": subject})
    except Exception as exc:
        logger.warning("notification.send_failed", extra={"to": email, "subject": subject, "error": str(exc)})
