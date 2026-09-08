"""
E2E test infrastructure for the marketplace backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed. The FastAPI app
is loaded in-process with DATABASE_URL pointed at `ai_trust_test` so dev data is
never touched.

Requires:
  - Docker Compose Postgres running on localhost:5432
  - POSTGRES_USER / POSTGRES_PASSWORD env vars (defaults: postgres/postgres)

The suite auto-skips if Postgres is not reachable.

Unlike a running deployment, e2e tests have NO Docker/k8s and NO Keycloak. The
deploy dispatch (`app.deploy.*`) and the Keycloak client provisioners (`app.keycloak.*`)
are patched to fakes in `e2e_setup`, so a deploy walks the router's full success/error
bookkeeping without ever building or pulling a container or minting a real OIDC client.
OpenFGA is bypassed the same way compliance does it (`openfga_client.check` → allow) and
`get_current_user` is overridden — tests set the authorization posture per-request by
monkeypatching `check`/`_fga` where a scenario needs a non-operator caller.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from unittest.mock import patch

# The keycloak module reads these at import time — set before app.main is imported.
os.environ.setdefault("KEYCLOAK_URL", "http://keycloak:8080")
os.environ.setdefault("KEYCLOAK_ADMIN", "admin")
os.environ.setdefault("KEYCLOAK_ADMIN_PASSWORD", "admin")
os.environ.setdefault("KEYCLOAK_PUBLIC_URL", "http://localhost:8180")
os.environ.setdefault("APP_PUBLIC_URL", "http://localhost:8080")

# Env dicts captured by the fake deploy backend, keyed by service name — lets a test assert exactly
# what environment (custom vars + auto-ISSUER + OIDC_*) reached the deploy call. Reset per e2e_setup.
DEPLOYED_ENV: dict[str, dict[str, str]] = {}

# Placeholder DATABASE_URL at collection time so ai_trust_persistence imports during
# collection; the real test DB URL is set in e2e_setup before any test runs.
_PG_USER = os.environ.get("POSTGRES_USER", "postgres")
_PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")
# Host/port are env-overridable so the same suite runs from the host (localhost:5432, the make
# test-e2e path) and from inside the backend container (PGHOST=postgres, where Postgres is reached
# by compose service name). Password defaults to the compose value via POSTGRES_PASSWORD.
_PG_HOST = os.environ.get("TEST_PGHOST", os.environ.get("PGHOST", "localhost"))
_PG_PORT = int(os.environ.get("TEST_PGPORT", os.environ.get("PGPORT", "5432")))
_TEST_DB = "ai_trust_test"
_TEST_DATABASE_URL = (
    f"postgresql+asyncpg://{_PG_USER}:{_PG_PASSWORD}@{_PG_HOST}:{_PG_PORT}/{_TEST_DB}"
)
os.environ.setdefault("DATABASE_URL", _TEST_DATABASE_URL)

# NullPool so SQLAlchemy opens/closes a fresh connection per request — no idle pool
# connections to conflict with TRUNCATE. Must be done before app.main is imported.
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
import ai_trust_persistence.database as _db
import ai_trust_persistence as _persistence_pkg

_test_engine = create_async_engine(_TEST_DATABASE_URL, poolclass=NullPool)
_test_session_factory = async_sessionmaker(_test_engine, expire_on_commit=False)

# Patch at both the database module and package level. Routers that do
# `from ai_trust_persistence import SessionLocal` bind the name at their own import
# time — they are imported lazily inside `e2e_setup`/`client` (via `from app.main import
# app`) which happens AFTER this conftest runs, so the patched value is what they see.
_db.engine = _test_engine
_db.SessionLocal = _test_session_factory
_persistence_pkg.engine = _test_engine
_persistence_pkg.SessionLocal = _test_session_factory

import psycopg2
import pytest
import pytest_asyncio
import httpx


def _find_alembic_ini() -> Path:
    """Locate libs/persistence/alembic.ini. On the host it sits at <repo>/libs/persistence
    (four parents up, mirroring compliance); inside the backend container the backend is the
    build context so it's at /app/libs/persistence. Walk up from here and check both shapes."""
    here = Path(__file__).resolve()
    for base in [here, *here.parents]:
        cand = base / "libs" / "persistence" / "alembic.ini"
        if cand.exists():
            return cand
    # Fall back to the compliance-style fixed depth (repo-root layout) for a clear error.
    return here.parents[4] / "libs" / "persistence" / "alembic.ini"


def _alembic_bin() -> str:
    """Prefer the backend's own venv alembic (host `make setup`), else alembic on PATH (container)."""
    venv = Path(__file__).parents[2] / ".venv" / "bin" / "alembic"
    return str(venv) if venv.exists() else "alembic"


_ALEMBIC_INI = _find_alembic_ini()
_ALEMBIC_BIN = _alembic_bin()

# Operator identity used by the default dependency override + as the caller for
# operator-gated endpoints. Header value backs the direct get_current_user() calls
# (list_services, proxy, _require_role_manager) that don't go through Depends.
OPERATOR = "test-operator"
OPERATOR_HEADERS = {"x-forwarded-preferred-username": OPERATOR}


def _pg_reachable() -> bool:
    try:
        conn = psycopg2.connect(
            host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD,
            dbname="postgres", connect_timeout=3,
        )
        conn.close()
        return True
    except Exception:
        return False


def _ensure_test_db() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD, dbname="postgres",
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (_TEST_DB,))
    if not cur.fetchone():
        cur.execute(f'CREATE DATABASE "{_TEST_DB}"')
    cur.close()
    conn.close()


def _run_migrations() -> None:
    subprocess.run(
        [str(_ALEMBIC_BIN), "-c", str(_ALEMBIC_INI), "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": _TEST_DATABASE_URL},
        check=True,
    )


def _truncate() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD, dbname=_TEST_DB,
    )
    conn.autocommit = True
    cur = conn.cursor()
    # Terminate connections holding the tables so TRUNCATE's ACCESS EXCLUSIVE lock is free.
    cur.execute(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        "WHERE datname = %s AND pid <> pg_backend_pid() "
        "AND (state IN ('idle', 'idle in transaction') "
        "     OR (state = 'active' AND wait_event = 'ClientRead'))",
        (_TEST_DB,),
    )
    cur.execute(
        "TRUNCATE marketplace_services, marketplace_app_enabled_users, "
        "marketplace_app_enabled_roles RESTART IDENTITY CASCADE"
    )
    cur.close()
    conn.close()


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    """Auto-skip if Postgres unreachable; patch deploy + keycloak + OpenFGA for all tests."""
    if not _pg_reachable():
        pytest.skip("Postgres not reachable at localhost:5432 — start Docker Compose first")
    _ensure_test_db()
    _run_migrations()
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:8080")
    os.environ.setdefault("OPENFGA_URL", "http://localhost:8080")
    os.environ.setdefault("OPENFGA_STORE_ID", "test-store-id")

    # Fake deploy backend: no Docker/k8s. Returns a plausible (host, image) so the router
    # flips the row to "running" and records service_host, mirroring a real deploy.
    # Captured env dicts (by service name) so tests can assert what reached the deploy call.
    DEPLOYED_ENV.clear()

    async def _fake_create_static(name, git_url, git_ref):
        return f"mkt-{name}-svc"

    async def _fake_build_and_deploy(name, git_url, git_ref, app_port, env, secret_env):
        DEPLOYED_ENV[name] = dict(env)
        return f"mkt-{name}-svc", f"localhost:5000/mkt-{name}:{git_ref}"

    async def _fake_run_image(name, image_ref, app_port, env, secret_env, registry_auth=None):
        DEPLOYED_ENV[name] = dict(env)
        return f"mkt-{name}-svc", image_ref

    async def _fake_delete(name):
        return None

    with (
        patch("app.deploy.create_static_service", new=_fake_create_static),
        patch("app.deploy.build_and_deploy", new=_fake_build_and_deploy),
        patch("app.deploy.run_image", new=_fake_run_image),
        patch("app.deploy.delete_service", new=_fake_delete),
        # Keycloak client provisioners — no real Keycloak. Deterministic client id + secret.
        patch("app.keycloak.ensure_app_client", new=lambda name, base_url: f"aitrust-app-{name}"),
        patch("app.keycloak.ensure_federation_client",
              new=lambda name, redirect_uri, base_url: f"aitrust-app-{name}"),
        patch("app.keycloak.get_client_secret", new=lambda client_id: "test-secret"),
        patch("app.keycloak.rotate_client_secret", new=lambda client_id: "rotated-secret"),
    ):
        import ai_trust_authorization.openfga_client as _fga
        from ai_trust_authorization.permissions import get_current_user
        from app.main import app

        async def _always_allowed(*_a, **_kw) -> bool:
            return True

        _fga.check = _always_allowed
        app.dependency_overrides[get_current_user] = lambda: OPERATOR

        yield


@pytest_asyncio.fixture(autouse=True)
async def truncate_tables():
    yield
    _truncate()


@pytest_asyncio.fixture
async def client():
    from app.main import app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers=OPERATOR_HEADERS,
        timeout=10,
    ) as ac:
        yield ac


@pytest.fixture
def as_user(monkeypatch):
    """Return a controller to flip the caller between a non-operator user and the operator.

    `.user(name, roles=[...])` — become a plain user: `openfga_client.check` (operator gate) is
    forced False and `read_user_roles` returns the supplied roles, so `_is_enabled_for`/role-gating
    exercise the real deny-then-allow path. Returns the request headers for that user.
    `.operator()` — restore the operator posture (check → allow, get_current_user → OPERATOR), so a
    single test can register/enable as operator, then verify visibility as a plain user (or back).
    All patches are undone at test teardown by monkeypatch.
    """
    import ai_trust_authorization.openfga_client as _fga
    from ai_trust_authorization.permissions import get_current_user
    from app.main import app
    from app.routers import services as _svc

    async def _allow(*_a, **_kw) -> bool:
        return True

    class _Ctl:
        def user(self, username: str = "alice", roles: list[str] | None = None) -> dict:
            async def _deny(*_a, **_kw) -> bool:
                return False

            async def _roles(_user):
                return [f"role:{r}" for r in (roles or [])]

            monkeypatch.setattr(_fga, "check", _deny)
            # services._user_roles imports read_user_roles at module load — patch the bound name.
            monkeypatch.setattr(_svc, "read_user_roles", _roles)
            app.dependency_overrides[get_current_user] = lambda: username
            return {"x-forwarded-preferred-username": username}

        def operator(self) -> dict:
            monkeypatch.setattr(_fga, "check", _allow)
            app.dependency_overrides[get_current_user] = lambda: OPERATOR
            return OPERATOR_HEADERS

    return _Ctl()


# ---------------------------------------------------------------------------
# Shared helper functions (call directly, per the repo e2e-helper convention)
# ---------------------------------------------------------------------------

async def create_service(client: httpx.AsyncClient, **kwargs) -> dict:
    """POST /services — an internal app (default a static one). Override any field via kwargs."""
    payload = {"name": "weather", "label": "Weather", "kind": "static",
               "git_url": "https://example.com/weather.git", **kwargs}
    r = await client.post("/v1/services", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def register_discovered(client: httpx.AsyncClient, **kwargs) -> dict:
    """POST /discover/manual — register an already-running external app (no manifest)."""
    payload = {"name": "extapp", "label": "External App",
               "external_url": "https://app.example.com", "auth_mode": "bearer", **kwargs}
    r = await client.post("/v1/discover/manual", json=payload)
    assert r.status_code == 201, r.text
    return r.json()
