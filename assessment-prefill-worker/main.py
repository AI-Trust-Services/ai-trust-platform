"""Assessment Prefill Worker — durable DB-polling replacement for FastAPI BackgroundTasks.

Polls Postgres for assessments with ``llm_status='pending'``, claims one with
``FOR UPDATE SKIP LOCKED`` (safe at any replica count), flips it to ``'processing'``,
then runs the same prefill pipeline that the registry backend runs in-process.

On startup, any row stuck in ``'processing'`` from a previous crash is reset to
``'pending'`` so it is claimed on the next poll cycle.
"""

import asyncio
import os

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from ai_trust_logging import get_logger
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment import Assessment

# app.* is importable because the Dockerfile COPYs the full registry backend/ on top
# of its own entry point. The pipeline and helpers live there — single source of truth.
from app.assessment_prefill_pipeline import run_assessment_prefill_pipeline  # noqa: F401
from app.routers.assessment import _run_prefill_background, _system_owner

POLL_INTERVAL = int(os.environ.get("PREFILL_POLL_INTERVAL", "30"))

log = get_logger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

try:
    from ai_trust_tenancy import install_tenant_scoping

    install_tenant_scoping(engine)
except ImportError:
    pass


async def _reset_stale_processing() -> int:
    """On startup flip any 'processing' rows back to 'pending' (pod-crash recovery)."""
    async with SessionLocal() as session:
        result = await session.execute(
            update(Assessment)
            .where(Assessment.llm_status == "processing")
            .values(llm_status="pending")
        )
        await session.commit()
        count = result.rowcount or 0
    if count:
        log.info("prefill_worker.requeued_stale", extra={"count": count})
    return count


async def _claim_one() -> tuple | None:
    """Atomically claim one pending assessment.

    Uses SELECT … FOR UPDATE SKIP LOCKED so multiple worker replicas never
    double-schedule the same assessment. Returns (assessment_id, system_id, user)
    or None when the queue is empty.
    """
    async with SessionLocal() as session:
        result = await session.execute(
            select(Assessment, AISystem)
            .join(AISystem, AISystem.id == Assessment.ai_system_id)
            .where(
                Assessment.llm_status == "pending",
                Assessment.status != "inactive",
            )
            .order_by(Assessment.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        row = result.one_or_none()
        if row is None:
            return None
        assessment, system = row
        assessment.llm_status = "processing"
        await session.commit()
        return assessment.id, system.id, _system_owner(system) or "svc-prefill-worker"


async def _drain() -> None:
    """Claim and run prefill for every pending assessment, then return."""
    while True:
        claimed = await _claim_one()
        if claimed is None:
            return
        assessment_id, system_id, user = claimed
        log.info(
            "prefill_worker.processing",
            extra={"assessment_id": assessment_id, "system_id": system_id},
        )
        try:
            await _run_prefill_background(system_id, assessment_id, user)
        except Exception as exc:
            log.exception(
                "prefill_worker.error",
                extra={
                    "assessment_id": assessment_id,
                    "system_id": system_id,
                    "error": str(exc),
                },
            )


async def main() -> None:
    log.info("Assessment prefill worker starting (interval=%ds)", POLL_INTERVAL)
    await _reset_stale_processing()
    log.info("Assessment prefill worker started")

    while True:
        try:
            await _drain()
        except Exception:
            log.exception("prefill_worker.loop_error")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
