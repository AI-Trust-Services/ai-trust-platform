from __future__ import annotations

from email.mime.text import MIMEText

import aiosmtplib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import require_permission
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.platform_settings import PlatformSettings
from ai_trust_logging import get_logger

from app.schemas import SmtpSettingsResponse, SmtpSettingsUpdate, SmtpTestRequest, SmtpTestResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/smtp", tags=["smtp"])


async def _get_settings() -> PlatformSettings:
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")
        return row


@router.get("", response_model=SmtpSettingsResponse)
async def get_smtp(_: str = Depends(require_permission(IAM_MANAGE))) -> SmtpSettingsResponse:
    row = await _get_settings()
    return SmtpSettingsResponse(
        smtp_host=row.smtp_host,
        smtp_port=row.smtp_port,
        smtp_user=row.smtp_user,
        has_password=bool(row.smtp_password),
        smtp_from=row.smtp_from,
        smtp_from_name=row.smtp_from_name,
        smtp_ssl=row.smtp_ssl,
        smtp_starttls=row.smtp_starttls,
    )


@router.put("", response_model=SmtpSettingsResponse)
async def update_smtp(
    body: SmtpSettingsUpdate,
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> SmtpSettingsResponse:
    async with SessionLocal() as session:
        row = await session.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
        if row is None:
            raise HTTPException(status_code=503, detail="Platform settings not initialised")

        row.smtp_host = body.smtp_host or None
        row.smtp_port = body.smtp_port
        row.smtp_user = body.smtp_user or None
        if body.smtp_password:
            row.smtp_password = body.smtp_password
        row.smtp_from = body.smtp_from or None
        row.smtp_from_name = body.smtp_from_name or None
        row.smtp_ssl = body.smtp_ssl
        row.smtp_starttls = body.smtp_starttls

        await session.commit()
        await session.refresh(row)
        logger.info("admin.smtp.updated")

    return SmtpSettingsResponse(
        smtp_host=row.smtp_host,
        smtp_port=row.smtp_port,
        smtp_user=row.smtp_user,
        has_password=bool(row.smtp_password),
        smtp_from=row.smtp_from,
        smtp_from_name=row.smtp_from_name,
        smtp_ssl=row.smtp_ssl,
        smtp_starttls=row.smtp_starttls,
    )


@router.post("/test", response_model=SmtpTestResponse)
async def test_smtp(
    body: SmtpTestRequest,
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> SmtpTestResponse:
    row = await _get_settings()

    if not row.smtp_host:
        return SmtpTestResponse(success=False, message="SMTP host is not configured. Save settings first.")
    if not row.smtp_from:
        return SmtpTestResponse(success=False, message="From address is not configured. Save settings first.")

    msg = MIMEText(f"This is a test email from {row.platform_name} to verify your SMTP configuration.", "plain")
    msg["Subject"] = f"{row.platform_name} — SMTP test"
    msg["From"] = f"{row.smtp_from_name} <{row.smtp_from}>" if row.smtp_from_name else row.smtp_from
    msg["To"] = str(body.to)

    try:
        await aiosmtplib.send(
            msg,
            hostname=row.smtp_host,
            port=row.smtp_port or 587,
            username=row.smtp_user or None,
            password=row.smtp_password or None,
            use_tls=row.smtp_ssl,
            start_tls=row.smtp_starttls,
            timeout=10,
        )
        logger.info("admin.smtp.test_sent", extra={"to": str(body.to)})
        return SmtpTestResponse(success=True, message=f"Test email sent successfully to {body.to}.")
    except aiosmtplib.SMTPAuthenticationError:
        return SmtpTestResponse(success=False, message="Authentication failed — check username and password.")
    except aiosmtplib.SMTPConnectError:
        return SmtpTestResponse(success=False, message="Connection refused — check SMTP host and port.")
    except aiosmtplib.SMTPRecipientRefused:
        return SmtpTestResponse(success=False, message="Recipient address rejected by the mail server.")
    except (aiosmtplib.SMTPTimeoutError, TimeoutError):
        return SmtpTestResponse(success=False, message="Connection timed out — host unreachable.")
    except Exception as exc:
        logger.warning("admin.smtp.test_failed", extra={"error": str(exc)})
        return SmtpTestResponse(success=False, message=f"Send failed: {exc}")
