"""Audit Flush Worker — drains the Postgres audit_events buffer into ClickHouse.

Every FLUSH_INTERVAL seconds:
  1. SELECT up to BATCH_SIZE rows WHERE flushed_at IS NULL ORDER BY created_at
  2. Batch-insert into ClickHouse otel.audit_events
  3. Mark those rows flushed_at = now()

Postgres is the write-ahead log (atomic with business actions).
ClickHouse is the queryable archive with TTL → MinIO cold storage.
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from ai_trust_clickhouse import AUDIT_EVENTS, AUDIT_EVENTS_COLUMNS, get_client
from ai_trust_logging import get_logger
from ai_trust_persistence.models.audit_event import AuditEvent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = get_logger(__name__)

DATABASE_URL   = os.environ["DATABASE_URL"]
FLUSH_INTERVAL = int(os.environ.get("AUDIT_FLUSH_INTERVAL", "5"))
BATCH_SIZE     = int(os.environ.get("AUDIT_FLUSH_BATCH_SIZE", "500"))

engine       = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

try:
    from ai_trust_tenancy import install_tenant_scoping
    install_tenant_scoping(engine)
except ImportError:
    pass


def _to_ch_row(event: AuditEvent) -> list:
    return [
        event.id,
        event.created_at.replace(tzinfo=None) if event.created_at.tzinfo else event.created_at,
        event.actor_username,
        event.action,
        event.resource_type,
        event.resource_id,
        event.ai_system_id or "",
        event.ai_system_name or "",
        json.dumps(event.changes) if event.changes else "{}",
        event.source or "ui",
    ]


async def flush_once(ch_client) -> int:
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AuditEvent)
            .where(AuditEvent.flushed_at.is_(None))
            .order_by(AuditEvent.created_at)
            .limit(BATCH_SIZE)
        )).scalars().all()

        if not rows:
            return 0

        ch_client.insert(AUDIT_EVENTS, [_to_ch_row(r) for r in rows], column_names=AUDIT_EVENTS_COLUMNS)

        ids = [r.id for r in rows]
        await session.execute(
            update(AuditEvent)
            .where(AuditEvent.id.in_(ids))
            .values(flushed_at=datetime.now(timezone.utc))
        )
        await session.commit()

    log.info("audit.flushed", extra={"count": len(rows)})
    return len(rows)


async def main() -> None:
    ch_client = get_client(database="otel")
    log.info("Audit flush worker started (interval=%ds, batch=%d)", FLUSH_INTERVAL, BATCH_SIZE)

    while True:
        await asyncio.sleep(FLUSH_INTERVAL)
        try:
            await flush_once(ch_client)
        except Exception:
            log.exception("audit.flush_error")


if __name__ == "__main__":
    asyncio.run(main())
