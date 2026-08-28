"""Tenant helper for ClickHouse.

Tenant isolation for telemetry is physical: each tenant's spans/alerts live in that
tenant's OWN ClickHouse database (``tenant_<org>``), reached through a per-tenant client
(``get_client_for_tenant``) and written by the consumer's per-tenant routing. There is no
in-row tenant filter — queries run against the tenant's database directly.

``current_tenant()`` exposes the current request's tenant id (from the ContextVar set by
``libs/tenancy``) so callers can pick the right per-tenant client for DB ROUTING. It is not
a row filter.
"""
from __future__ import annotations

try:
    from ai_trust_tenancy import tenant_id_var  # ContextVar[str | None]
except ImportError:  # libs/tenancy not installed
    tenant_id_var = None


def current_tenant() -> str | None:
    return tenant_id_var.get() if tenant_id_var is not None else None
