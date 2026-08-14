from __future__ import annotations

import re

from ai_trust_tenancy.config import MODE
from ai_trust_tenancy.context import tenant_id_var

# A tenant id is a Platform Mesh account / realm name — restrict to a safe charset so it can be
# inlined into the SET as a literal without any driver-specific paramstyle (the raw DBAPI conn in
# the `begin` event is asyncpg, which uses $1 not %s). Anything outside this is rejected (no SET),
# so RLS then shows only shared/NULL rows — fail-closed.
_SAFE_TENANT = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


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
    def _set_tenant_on_begin(conn):  # conn: a raw DBAPI-level connection wrapper (asyncpg)
        tenant = tenant_id_var.get()
        if tenant and _SAFE_TENANT.match(tenant):
            # Schema-per-tenant with a HARD, DB-enforced wall:
            #  - search_path routes queries into the tenant's own schema,
            #  - SET LOCAL ROLE t_<org> switches to a per-tenant role that has USAGE on ONLY that schema,
            #    so Postgres itself denies any cross-tenant access (not just RLS filtering it to 0 rows),
            #  - app.current_tenant keeps the in-schema RLS policies active too (defense-in-depth).
            # All transaction-local (SET LOCAL / set_config(...,true)) so nothing leaks across the pool.
            # Schema + role names replace '-' with '_' to be valid unquoted identifiers; SAME derivation
            # is used by the operator's provisioning Job (create role/schema) and the data-migration.
            safe = tenant.replace("-", "_")
            schema = "tenant_" + safe
            role = "t_" + safe
            conn.exec_driver_sql(
                f"SELECT set_config('search_path', '\"{schema}\",public', true), "
                f"set_config('app.current_tenant', '{tenant}', true)"
            )
            # SET LOCAL ROLE cannot be parameterized; the role name is charset-validated above.
            conn.exec_driver_sql(f'SET LOCAL ROLE "{role}"')
        else:
            # Fail-closed: no valid tenant → do NOT switch role (stay as the shared login role with NO
            # direct schema access) and stay on public (no tenant tables) with app.current_tenant unset.
            conn.exec_driver_sql("SELECT set_config('search_path', 'public', true)")
