import logging
import os
import re

import clickhouse_connect

log = logging.getLogger(__name__)

# A tenant/database name must be a safe ClickHouse identifier (we inline it into `USE`/db names).
_SAFE_DB = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


def get_client(database: str | None = None):
    host = os.environ["CLICKHOUSE_HOST"]
    port = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
    log.info("Connecting to ClickHouse at %s:%s (db=%s)", host, port, database or "<default>")
    kwargs = dict(
        host=host,
        port=port,
        username=os.environ["CLICKHOUSE_USER"],
        password=os.environ["CLICKHOUSE_PASSWORD"],
    )
    if database:
        kwargs["database"] = database
    return clickhouse_connect.get_client(**kwargs)


def db_for_tenant(tenant: str | None) -> str:
    """The ClickHouse database name for a tenant. Mirrors the Postgres schema naming
    (`tenant_<org>` with '-'→'_') so all stores agree. None/empty → legacy 'otel'."""
    if not tenant:
        return "otel"
    name = "tenant_" + tenant.replace("-", "_")
    if not _SAFE_DB.match(name):
        # fail-closed: an unexpected tenant string must not be inlined into a db name
        raise ValueError(f"unsafe tenant database name: {name!r}")
    return name


def get_client_for_tenant(tenant: str | None):
    """ClickHouse client bound to the tenant's own database `tenant_<org>` (physical isolation),
    falling back to the legacy 'otel' database when no tenant is resolved. Callers on the read
    path pass current_tenant(); the consumer passes each span's tenant on the write path."""
    return get_client(database=db_for_tenant(tenant))

