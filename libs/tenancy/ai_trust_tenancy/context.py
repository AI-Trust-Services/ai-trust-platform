from contextvars import ContextVar

# The tenant the current request/task belongs to. Mirrors `correlation_id_var` in
# libs/logging: because it is a ContextVar, it propagates automatically through every
# `await` in the same request, so the DB session hook (session.py) can read it without
# any explicit plumbing. `None` = no tenant (single-tenant mode, or an unscoped worker
# pass) → the RLS policy's `tenant_id IS NULL` branch applies (shared/catalog rows).
tenant_id_var: ContextVar[str | None] = ContextVar("tenant_id", default=None)
