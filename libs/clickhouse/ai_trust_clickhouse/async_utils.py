from __future__ import annotations

import asyncio

from ai_trust_clickhouse.database import get_client_for_tenant
from ai_trust_clickhouse.tenant import current_tenant


async def ch_query(sql: str, params: dict | None = None) -> list[dict]:
    """Run a ClickHouse SELECT in a thread pool, routed to the CURRENT TENANT's database
    (physical per-tenant isolation). Table names in `sql` must be UNQUALIFIED (e.g.
    `gen_ai_spans`) so they resolve against the connection's per-tenant database; no tenant
    resolved → legacy 'otel' db (which holds no real tenant rows → fail-closed)."""
    def _run():
        client = get_client_for_tenant(current_tenant())
        result = client.query(sql, parameters=params or {})
        return [dict(zip(result.column_names, row)) for row in result.result_rows]
    return await asyncio.get_running_loop().run_in_executor(None, _run)


async def ch_command(sql: str, params: dict | None = None) -> None:
    """Run a ClickHouse command (ALTER, etc.) in a thread pool, routed to the current tenant's db."""
    def _run():
        client = get_client_for_tenant(current_tenant())
        client.command(sql, parameters=params or {})
    await asyncio.get_running_loop().run_in_executor(None, _run)
