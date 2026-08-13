"""RLS isolation integration test (SEC-M1 + tenant read/write isolation).

Requires a Postgres with migrations applied through 0010 and the non-superuser role
`ai_trust_app` (NOBYPASSRLS). Because the e2e harness normally connects as the OWNER
(which BYPASSES RLS), this test explicitly `SET ROLE ai_trust_app` so the policy is
actually exercised.

Run: requires a live/test Postgres (docker compose up -d postgres); skipped otherwise.
"""
from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.asyncio

DB = os.environ.get("DATABASE_URL", "")
skip = pytest.mark.skipif(not DB, reason="DATABASE_URL not set (needs a test Postgres)")


@skip
async def test_rls_read_and_write_isolation():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(DB)
    a, b = f"tA-{uuid.uuid4().hex[:8]}", f"tB-{uuid.uuid4().hex[:8]}"
    sysA, sysB = f"SYS-{uuid.uuid4().hex[:6]}", f"SYS-{uuid.uuid4().hex[:6]}"
    try:
        # seed as owner (bypasses RLS)
        async with engine.begin() as conn:
            for sid, t in ((sysA, a), (sysB, b)):
                await conn.execute(text(
                    "INSERT INTO ai_systems (id,name,tier,tenant_id) VALUES (:i,:n,'minimal',:t)"
                ), {"i": sid, "n": sid, "t": t})

        # as the RLS-bound app role, tenant A sees only A
        async with engine.connect() as conn:
            await conn.execute(text("SET ROLE ai_trust_app"))
            await conn.execute(text("SELECT set_config('app.current_tenant', :t, false)"), {"t": a})
            seen = {r[0] for r in (await conn.execute(text(
                "SELECT id FROM ai_systems WHERE id IN (:x,:y)"), {"x": sysA, "y": sysB})).all()}
            assert seen == {sysA}, f"tenant A should see only its own row, saw {seen}"

            # SEC-M1: A cannot write a row tagged for B (WITH CHECK write-own)
            with pytest.raises(Exception):
                await conn.execute(text(
                    "INSERT INTO ai_systems (id,name,tier,tenant_id) VALUES (:i,'x','minimal',:t)"
                ), {"i": f"SYS-{uuid.uuid4().hex[:6]}", "t": b})

            # SEC-M1: A cannot write a globally-shared (NULL) row
            with pytest.raises(Exception):
                await conn.execute(text(
                    "INSERT INTO ai_systems (id,name,tier,tenant_id) VALUES (:i,'x','minimal',NULL)"
                ), {"i": f"SYS-{uuid.uuid4().hex[:6]}"})
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("RESET ROLE"))
            await conn.execute(text("DELETE FROM ai_systems WHERE id IN (:x,:y)"),
                               {"x": sysA, "y": sysB})
        await engine.dispose()
