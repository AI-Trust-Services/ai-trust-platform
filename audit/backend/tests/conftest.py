"""
Sets ALLOWED_ORIGINS and ClickHouse env vars before pytest collection.

Required because the app reads these at import time.
"""
import os

os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
os.environ.setdefault("CLICKHOUSE_HOST", "localhost")
os.environ.setdefault("CLICKHOUSE_PORT", "8123")
os.environ.setdefault("CLICKHOUSE_USER", "default")
os.environ.setdefault("CLICKHOUSE_PASSWORD", "")
os.environ.setdefault("OPENFGA_URL", "http://localhost:8080")
os.environ.setdefault("OPENFGA_STORE_ID", "test-store-id")
