"""Tenant-scoping helper for ClickHouse queries (SEC-C3).

ClickHouse has no row-level security, so every read/write MUST filter by tenant in the
query itself. This helper centralizes that so callers can't forget it and so the
fail-closed behaviour is uniform.

Usage (read):
    frag, params = tenant_clause("received_at >= now() - INTERVAL 1 HOUR")
    ch_query(f"SELECT ... FROM otel.gen_ai_spans WHERE {frag} GROUP BY ...", params)

Behaviour by TENANCY_MODE (read from libs/tenancy, guarded import):
  - single  : no-op ("1=1") — single-tenant deploy unchanged.
  - jwt/header, tenant resolved   : "tenant_id = {tenant:String}" + param.
  - jwt/header, tenant NOT resolved: "1=0" (fail-closed — return nothing rather than all
    tenants' rows). The HTTP middleware already 401s unresolved jwt requests, so this is a
    defense-in-depth backstop for non-request contexts.
"""
from __future__ import annotations

try:
    from ai_trust_tenancy import tenant_id_var  # ContextVar[str | None]
    from ai_trust_tenancy.config import MODE as _TENANCY_MODE
except ImportError:  # libs/tenancy not installed (e.g. single-tenant tooling)
    tenant_id_var = None
    _TENANCY_MODE = "single"


def current_tenant() -> str | None:
    return tenant_id_var.get() if tenant_id_var is not None else None


def tenant_clause(*extra: str, param: str = "tenant") -> tuple[str, dict]:
    """Return (where_fragment, params) that scopes a ClickHouse query to the current tenant.

    `extra` are additional WHERE conditions AND-ed together with the tenant predicate, so
    callers build the whole WHERE in one place. Always returns a non-empty fragment.
    """
    conds = list(extra)
    params: dict = {}
    if _TENANCY_MODE == "single":
        conds.append("1=1")
    else:
        tenant = current_tenant()
        if tenant:
            conds.append(f"tenant_id = {{{param}:String}}")
            params[param] = tenant
        else:
            conds.append("1=0")  # fail-closed: no tenant → no rows
    return " AND ".join(c for c in conds if c), params
