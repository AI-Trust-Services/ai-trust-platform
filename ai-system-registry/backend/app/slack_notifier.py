"""Fire-and-forget Slack channel notifications via Incoming Webhook."""
from __future__ import annotations

import os

import httpx

from ai_trust_logging import get_logger

logger = get_logger(__name__)

_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")
_REGISTRY_URL = "http://localhost:8080/registry/"
_USERS_BACKEND_URL = os.environ.get("USERS_BACKEND_URL", "http://users-backend:8008")


async def _get_display_name(username: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"{_USERS_BACKEND_URL}/internal/users/email-lookup",
                json={"username": username},
            )
            resp.raise_for_status()
            return resp.json().get("display_name") or username
    except Exception:
        return username


async def _post(text: str) -> None:
    if not _WEBHOOK_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(_WEBHOOK_URL, json={"text": text})
            resp.raise_for_status()
        logger.info("slack.notification_sent", extra={"text": text[:60]})
    except Exception as exc:
        logger.warning("slack.notification_failed", extra={"error": str(exc)})


async def notify_assigned(system_name: str, system_id: str, tier: str, assignee: str) -> None:
    name = await _get_display_name(assignee)
    await _post(
        f"*AI System assigned to you*\n"
        f"{name}, you have been assigned to complete the technical details for this system.\n"
        f"System: {system_name} ({system_id}) | Risk tier: {tier}\n"
        f"<{_REGISTRY_URL}|Open in AI Trust Platform>"
    )


async def notify_submitted(system_name: str, system_id: str, tier: str, assignee: str) -> None:
    name = await _get_display_name(assignee)
    await _post(
        f"*AI System ready for your review*\n"
        f"{name}, this system has been submitted and is waiting for your compliance review.\n"
        f"System: {system_name} ({system_id}) | Risk tier: {tier}\n"
        f"<{_REGISTRY_URL}|Open in AI Trust Platform>"
    )


async def notify_rejected(system_name: str, system_id: str, tier: str, assignee: str, note: str) -> None:
    name = await _get_display_name(assignee)
    await _post(
        f"*AI System rejected — action required*\n"
        f"{name}, this system has been rejected. Rejection note: {note}\n"
        f"System: {system_name} ({system_id}) | Risk tier: {tier}\n"
        f"<{_REGISTRY_URL}|Open in AI Trust Platform>"
    )
