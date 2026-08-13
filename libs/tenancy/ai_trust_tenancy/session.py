from __future__ import annotations

from ai_trust_tenancy.config import MODE
from ai_trust_tenancy.context import tenant_id_var


def install_tenant_scoping(engine) -> None:
    """Make every DB transaction set Postgres' `app.current_tenant` from the ContextVar.

    This is what turns the row-level-security policies (migration 0009) on: the policy
    filters on `current_setting('app.current_tenant', true)`, and this hook sets that
    value at the start of each transaction to whatever tenant the request middleware
    resolved. Because it fires on the engine's `begin` event, it covers EVERY
    `async with SessionLocal() as session:` block without editing any call site.

    Implementation notes:
      - `SELECT set_config(name, value, is_local=true)` is used instead of `SET LOCAL`
        because SET LOCAL cannot bind parameters and asyncpg dislikes it via prepared
        statements. `is_local=true` scopes the value to the current transaction (reverts
        on commit/rollback), which is exactly the SET LOCAL semantics we want.
      - Registered on the underlying SYNC engine (AsyncEngine.sync_engine); SQLAlchemy's
        async layer drives this sync engine, so the event still fires per async txn.
      - No-op in single mode (never registered) → zero overhead for the full-copy deploy.
      - sqlalchemy is imported lazily HERE (not at module top) so that services without a
        database (e.g. the ClickHouse-only decision-trace-analyzer) can still import the
        rest of ai_trust_tenancy (middleware/resolver) without sqlalchemy installed.
    """
    if MODE == "single":
        return

    from sqlalchemy import event  # lazy: only needed when a DB engine is being scoped

    sync_engine = getattr(engine, "sync_engine", engine)

    @event.listens_for(sync_engine, "begin")
    def _set_tenant_on_begin(conn):  # conn: a raw DBAPI-level connection wrapper
        tenant = tenant_id_var.get()
        if tenant:
            conn.exec_driver_sql(
                "SELECT set_config('app.current_tenant', %s, true)", (tenant,)
            )
