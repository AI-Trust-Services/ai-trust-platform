from __future__ import annotations

import asyncio

from ai_trust_clickhouse.database import get_client_for_tenant
from ai_trust_clickhouse.tenant import current_tenant


async def ch_query(sql: str, params: dict | None = None) -> list[dict]:
    """Run a ClickHouse SELECT in a thread pool, routed to the CURRENT TENANT's database
    (physical per-tenant isolation). Table names in `sql` must be UNQUALIFIED (e.g.
    `gen_ai_spans`) so they resolve against the connection's per-tenant database. In a
    multi-tenant mode an unresolved tenant is fail-closed (get_client_for_tenant raises);
    in `single` mode it binds the shared 'otel' database."""
    # Resolve the tenant HERE, on the event loop, where the request's ContextVar is set.
    # ContextVars do NOT propagate into run_in_executor() worker threads, so calling
    # current_tenant() inside _run always sees None → fail-closed RuntimeError in jwt mode.
    # Capture it now and close over it.
    tenant = current_tenant()
    def _run():
        client = get_client_for_tenant(tenant)
        result = client.query(sql, parameters=params or {})
        return [dict(zip(result.column_names, row)) for row in result.result_rows]
    return await asyncio.get_running_loop().run_in_executor(None, _run)


async def ch_command(sql: str, params: dict | None = None) -> None:
    """Run a ClickHouse command (ALTER, etc.) in a thread pool, routed to the current tenant's db."""
    tenant = current_tenant()  # capture on the event loop — ContextVars don't cross into the executor thread
    def _run():
        client = get_client_for_tenant(tenant)
        client.command(sql, parameters=params or {})
    await asyncio.get_running_loop().run_in_executor(None, _run)
