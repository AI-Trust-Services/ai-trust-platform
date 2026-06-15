import logging
from pathlib import Path

from ai_trust_clickhouse import get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

CREATE_MIGRATIONS_TABLE = """
CREATE TABLE IF NOT EXISTS otel.schema_migrations
(
    version    String,
    applied_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY version;
"""


def get_applied(client) -> set[str]:
    result = client.query("SELECT version FROM otel.schema_migrations")
    return {row[0] for row in result.result_rows}


def _statements(sql: str) -> list[str]:
    return [s.strip() for s in sql.split(";") if s.strip()]


def run() -> None:
    client = get_client()

    client.command("CREATE DATABASE IF NOT EXISTS otel")
    client.command(CREATE_MIGRATIONS_TABLE)

    applied = get_applied(client)
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

    if not migration_files:
        log.info("No migration files found in %s", MIGRATIONS_DIR)
        return

    for path in migration_files:
        version = path.stem
        if version in applied:
            log.info("Skipping %s (already applied)", version)
            continue

        log.info("Applying %s", version)
        for statement in _statements(path.read_text()):
            client.command(statement)

        client.insert("otel.schema_migrations", [[version]], column_names=["version"])
        log.info("Applied %s", version)

    log.info("Migrations complete")


if __name__ == "__main__":
    run()
