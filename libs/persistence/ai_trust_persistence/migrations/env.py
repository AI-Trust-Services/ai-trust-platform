import asyncio
import os
import re
from logging.config import fileConfig

from alembic import context
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from ai_trust_persistence.database import DATABASE_URL, Base
import ai_trust_persistence.models  # noqa: F401 — register all models

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Schema-per-tenant: when TARGET_SCHEMA is set (e.g. "tenant_fridaytest"), a full `alembic upgrade head`
# builds the ENTIRE table set inside that schema, and alembic tracks its version in that schema's own
# alembic_version table. Default "public" keeps the single-tenant / shared behaviour unchanged.
# Charset-restricted so it can be inlined into DDL safely (it names a Postgres schema).
_TARGET_SCHEMA = os.environ.get("TARGET_SCHEMA", "public").strip() or "public"
if not re.match(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$", _TARGET_SCHEMA):
    raise SystemExit(f"invalid TARGET_SCHEMA={_TARGET_SCHEMA!r}")


def run_migrations_offline() -> None:
    _kw = {}
    if _TARGET_SCHEMA != "public":
        _kw["schema_translate_map"] = {None: _TARGET_SCHEMA}
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=_TARGET_SCHEMA,
        **_kw,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    # Schema-per-tenant routing. Two independent mechanisms are needed because our migrations mix
    # two DDL styles, and each style resolves the schema differently:
    #
    #   1. Core ops with bare names (op.create_table / op.add_column / sa.table, schema=None) —
    #      routed by SQLAlchemy's `schema_translate_map={None: target}`. This is a *connection*
    #      execution option, so it survives alembic's per-migration transactions (unlike a bare
    #      `SET search_path`, which is transaction-local and gets reset).
    #
    #   2. Raw SQL via op.execute("ALTER TABLE ai_systems ...") — schema_translate_map does NOT
    #      rewrite these opaque strings, so the bare identifiers must resolve via Postgres'
    #      search_path. We set it session-level (SELECT set_config(..., false)) so it persists
    #      across alembic's sub-transactions on this same connection.
    #
    # version_table_schema keeps each tenant's alembic_version inside its own schema.
    if _TARGET_SCHEMA != "public":
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{_TARGET_SCHEMA}"'))
        # session-level (is_local=false) so it outlives each migration's transaction
        connection.execute(
            text("SELECT set_config('search_path', :sp, false)"),
            {"sp": f'"{_TARGET_SCHEMA}",public'},
        )
        # Core DDL routing that persists across transactions (connection execution option).
        connection = connection.execution_options(
            schema_translate_map={None: _TARGET_SCHEMA}
        )

    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=_TARGET_SCHEMA,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(DATABASE_URL)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
        # engine.connect() (unlike engine.begin()) does not auto-commit on exit — it rolls back.
        # Our do_run_migrations opens an implicit transaction on the connection (CREATE SCHEMA /
        # set_config) that alembic's transactional-DDL context then reuses, so the DDL is NOT
        # committed by alembic's begin_transaction() alone. Commit the outer async connection
        # explicitly, or every migration is silently rolled back on context exit.
        await connection.commit()
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
