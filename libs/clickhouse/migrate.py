import logging
import os
import re
from pathlib import Path

from ai_trust_clickhouse import get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

# Database-per-tenant: TARGET_CH_DB selects which database to build the schema in. Default "otel"
# keeps the legacy/single behaviour. The operator sets it to tenant_<org> per tenant. The migration
# SQL files reference `otel.<table>`; we rewrite that prefix to the target db at apply time so one
# set of migrations builds the identical schema in every tenant database.
_TARGET_DB = os.environ.get("TARGET_CH_DB", "otel").strip() or "otel"
if not re.match(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$", _TARGET_DB):
    raise SystemExit(f"invalid TARGET_CH_DB={_TARGET_DB!r}")


def _retarget(sql: str) -> str:
    # rewrite the hardcoded 'otel.' database prefix to the target database
    return sql.replace("otel.", f"{_TARGET_DB}.") if _TARGET_DB != "otel" else sql


CREATE_MIGRATIONS_TABLE = _retarget("""
CREATE TABLE IF NOT EXISTS otel.schema_migrations
(
    version    String,
    applied_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY version;
""")


def get_applied(client) -> set[str]:
    result = client.query(f"SELECT version FROM {_TARGET_DB}.schema_migrations")
    return {row[0] for row in result.result_rows}


def _statements(sql: str) -> list[str]:
    # Strip `-- …` line comments before splitting on `;`. A semicolon inside
    # a comment (e.g. a sentence in a header doc-block) would otherwise cut
    # the comment into pieces and produce empty-query parts that ClickHouse
    # rejects with SYNTAX_ERROR code 62.
    no_comments = "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )
    return [s.strip() for s in no_comments.split(";") if s.strip()]


def run() -> None:
    client = get_client()

    log.info("Running ClickHouse migrations into database '%s'", _TARGET_DB)
    client.command(f"CREATE DATABASE IF NOT EXISTS {_TARGET_DB}")
    client.command(CREATE_MIGRATIONS_TABLE)

    applied = get_applied(client)
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

    if not migration_files:
        log.info("No migration files found in %s", MIGRATIONS_DIR)
        return

    for path in migration_files:
        version = path.stem
        if version in applied:
            log.info("[%s] Skipping %s (already applied)", _TARGET_DB, version)
            continue

        log.info("[%s] Applying %s", _TARGET_DB, version)
        for statement in _statements(_retarget(path.read_text())):
            client.command(statement)

        client.insert(f"{_TARGET_DB}.schema_migrations", [[version]], column_names=["version"])
        log.info("[%s] Applied %s", _TARGET_DB, version)

    log.info("Migrations complete for '%s'", _TARGET_DB)


if __name__ == "__main__":
    run()
