from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence.models.audit_event import AuditEvent


def _new_audit_id() -> str:
    return f"AUD-{uuid.uuid4().hex[:8].upper()}"


def log_audit_event(
    session: AsyncSession,
    actor: str,
    action: str,
    resource_type: str,
    resource_id: str,
    ai_system_id: str | None = None,
    ai_system_name: str | None = None,
    changes: dict | None = None,
    source: str = "ui",
) -> None:
    session.add(AuditEvent(
        id=_new_audit_id(),
        actor_username=actor,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ai_system_id=ai_system_id,
        ai_system_name=ai_system_name,
        changes=changes or {},
        source=source,
        flushed_at=None,
    ))
