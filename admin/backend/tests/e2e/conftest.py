"""
E2E test infrastructure for the admin backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
Postgres (SessionLocal) and OpenFGA are stubbed in-process so no
Docker services are required.

What is tested:
  - Route wiring and HTTP contract (status codes, response shapes)
  - Authorization enforcement (iam:manage gate on every endpoint)
  - GET returns current settings (password masked)
  - PUT updates each field group independently
  - SMTP test endpoint returns descriptive errors
  - Startup seed inserts a row only when none exists
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio

# Set required env vars before any app import
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:8080")
os.environ.setdefault("OPENFGA_URL", "http://openfga:8080")
os.environ.setdefault("OPENFGA_STORE_ID", "test-store-id")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
# SMTP env vars used by startup seed
os.environ.setdefault("SMTP_HOST", "mailpit")
os.environ.setdefault("SMTP_PORT", "1025")
os.environ.setdefault("SMTP_FROM", "noreply@ai-trust.local")
os.environ.setdefault("SMTP_FROM_NAME", "AI Trust Platform")
os.environ.setdefault("SMTP_SSL", "false")
os.environ.setdefault("SMTP_STARTTLS", "false")


# ---------------------------------------------------------------------------
# Default platform settings row returned by the DB mock
# ---------------------------------------------------------------------------

def _default_settings():
    row = MagicMock()
    row.id = 1
    row.platform_name = "AI Trust Platform"
    row.support_email = "support@example.com"
    row.smtp_host = "mailpit"
    row.smtp_port = 1025
    row.smtp_user = None
    row.smtp_password = "secret"
    row.smtp_from = "noreply@ai-trust.local"
    row.smtp_from_name = "AI Trust Platform"
    row.smtp_ssl = False
    row.smtp_starttls = False
    return row


def _make_session(row=None):
    """Return a mock async context-manager session that returns `row` on scalar()."""
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.scalar = AsyncMock(return_value=row if row is not None else _default_settings())
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def patch_openfga_and_startup():
    """Stub OpenFGA + startup seed for all tests."""
    with (
        patch("ai_trust_authorization.openfga_client.check", new=AsyncMock(return_value=True)),
        # Prevent lifespan seed from hitting the real DB
        patch("app.startup.seed_settings_from_env", new=AsyncMock()),
    ):
        from app.main import app
        from ai_trust_authorization.permissions import get_current_user
        app.dependency_overrides[get_current_user] = lambda: "test-user"
        yield
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client():
    from app.main import app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac
