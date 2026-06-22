"""
Sets DATABASE_URL, ALLOWED_ORIGINS and ClickHouse env vars before pytest collection.

Required because tests/e2e/test_alerts.py imports models from ai_trust_persistence
at module level, which reads DATABASE_URL at import time. The session-scoped
e2e_setup fixture in tests/e2e/conftest.py runs too late.
"""
import os

_PG_USER = os.environ.get("POSTGRES_USER", "postgres")
_PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault(
    "DATABASE_URL",
    f"postgresql+asyncpg://{_PG_USER}:{_PG_PASSWORD}@localhost:5432/ai_trust_test",
)
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3004")
os.environ.setdefault("CLICKHOUSE_HOST", "localhost")
os.environ.setdefault("CLICKHOUSE_PORT", "8123")
os.environ.setdefault("CLICKHOUSE_USER", "default")
os.environ.setdefault("CLICKHOUSE_PASSWORD", "")
