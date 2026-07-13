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
