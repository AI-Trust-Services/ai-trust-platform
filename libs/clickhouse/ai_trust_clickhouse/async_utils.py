from __future__ import annotations

import asyncio

from ai_trust_clickhouse.database import get_client


async def ch_query(sql: str, params: dict | None = None) -> list[dict]:
    """Run a ClickHouse SELECT query in a thread pool and return rows as dicts."""
    def _run():
        client = get_client()
        result = client.query(sql, parameters=params or {})
        return [dict(zip(result.column_names, row)) for row in result.result_rows]
    return await asyncio.get_running_loop().run_in_executor(None, _run)


async def ch_command(sql: str, params: dict | None = None) -> None:
    """Run a ClickHouse command (ALTER, etc.) in a thread pool."""
    def _run():
        client = get_client()
        client.command(sql, parameters=params or {})
    await asyncio.get_running_loop().run_in_executor(None, _run)
