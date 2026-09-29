# audit-flush-worker/

Standalone asyncio worker for the **audit** component (no HTTP port). It polls the Postgres audit buffer, batch-inserts rows into ClickHouse, then deletes them from Postgres.

Full guidance — data flow, flush interval, batch size, failure/retry behaviour — lives with the component it serves: [audit/CLAUDE.md](../audit/CLAUDE.md).
