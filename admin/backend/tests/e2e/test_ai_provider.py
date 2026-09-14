"""E2E tests for admin AI provider endpoints."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from tests.e2e.conftest import _make_session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ai_rows(active: str = "stub") -> list[MagicMock]:
    """Return a minimal set of AIProviderSetting mock rows."""
    def _row(provider, key, value, is_secret=False):
        r = MagicMock()
        r.provider = provider
        r.key = key
        r.value = value
        r.is_secret = is_secret
        return r

    return [
        _row("active", "provider", active),
        _row("ollama", "llm_base_url", "http://ollama:11434/v1"),
        _row("ollama", "llm_model", "llama3.2"),
        _row("ollama", "llm_vision_model", "llama3.2-vision"),
        _row("ollama", "llm_api_key", "ollama", is_secret=True),
        _row("external", "ai_client_id", "sb-test-id"),
        _row("external", "ai_client_secret", "super-secret", is_secret=True),
        _row("external", "ai_auth_url", "https://auth.example.com/oauth/token"),
        _row("external", "ai_api_url", "https://api.example.com"),
        _row("external", "ai_resource_group", "default"),
        _row("external", "ai_deployment_id", "deploy-123"),
        _row("external", "ai_api_version", "bedrock-2023-05-31"),
    ]


def _make_ai_session(rows: list | None = None):
    """Return a mock session whose execute() returns the given rows."""
    if rows is None:
        rows = _make_ai_rows()
    scalars_mock = MagicMock()
    scalars_mock.all = MagicMock(return_value=rows)
    result_mock = MagicMock()
    result_mock.scalars = MagicMock(return_value=scalars_mock)
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.execute = AsyncMock(return_value=result_mock)
    session.commit = AsyncMock()
    return session


# ---------------------------------------------------------------------------
# GET /v1/ai-provider
# ---------------------------------------------------------------------------

async def test_get_ai_provider_returns_active_provider(client: httpx.AsyncClient):
    session = _make_ai_session(_make_ai_rows(active="ollama"))
    with patch("app.routers.ai_provider.SessionLocal", return_value=session):
        r = await client.get("/v1/ai-provider")
    assert r.status_code == 200
    body = r.json()
    assert body["active_provider"] == "ollama"


async def test_get_ai_provider_masks_secrets(client: httpx.AsyncClient):
    session = _make_ai_session()
    with patch("app.routers.ai_provider.SessionLocal", return_value=session):
        r = await client.get("/v1/ai-provider")
    body = r.json()
    # Secret fields are masked as null in the response
    assert body["ollama"]["llm_api_key"] is None
    assert body["external"]["ai_client_secret"] is None
    # But has_* flags reflect that secrets exist
    assert body["has_ollama_api_key"] is True
    assert body["has_external_client_secret"] is True


async def test_get_ai_provider_has_flags_false_when_no_secret(client: httpx.AsyncClient):
    rows = _make_ai_rows()
    # Clear the secret values
    for r in rows:
        if r.key in ("llm_api_key", "ai_client_secret"):
            r.value = None
    session = _make_ai_session(rows)
    with patch("app.routers.ai_provider.SessionLocal", return_value=session):
        r = await client.get("/v1/ai-provider")
    body = r.json()
    assert body["has_ollama_api_key"] is False
    assert body["has_external_client_secret"] is False


async def test_get_ai_provider_returns_ollama_fields(client: httpx.AsyncClient):
    session = _make_ai_session()
    with patch("app.routers.ai_provider.SessionLocal", return_value=session):
        r = await client.get("/v1/ai-provider")
    ollama = r.json()["ollama"]
    assert ollama["llm_base_url"] == "http://ollama:11434/v1"
    assert ollama["llm_model"] == "llama3.2"
    assert ollama["llm_vision_model"] == "llama3.2-vision"


async def test_get_ai_provider_returns_external_fields(client: httpx.AsyncClient):
    session = _make_ai_session()
    with patch("app.routers.ai_provider.SessionLocal", return_value=session):
        r = await client.get("/v1/ai-provider")
    ext = r.json()["external"]
    assert ext["ai_client_id"] == "sb-test-id"
    assert ext["ai_auth_url"] == "https://auth.example.com/oauth/token"
    assert ext["ai_deployment_id"] == "deploy-123"


async def test_get_ai_provider_no_rows_defaults_to_stub(client: httpx.AsyncClient):
    session = _make_ai_session(rows=[])
    with patch("app.routers.ai_provider.SessionLocal", return_value=session):
        r = await client.get("/v1/ai-provider")
    assert r.status_code == 200
    assert r.json()["active_provider"] == "stub"


# ---------------------------------------------------------------------------
# PUT /v1/ai-provider
# ---------------------------------------------------------------------------

async def test_put_ai_provider_updates_active_provider(client: httpx.AsyncClient):
    load_session = _make_ai_session()
    save_session = AsyncMock()
    save_session.__aenter__ = AsyncMock(return_value=save_session)
    save_session.__aexit__ = AsyncMock(return_value=False)
    save_session.execute = AsyncMock()
    save_session.commit = AsyncMock()

    with patch("app.routers.ai_provider.SessionLocal", side_effect=[save_session, load_session]):
        r = await client.put("/v1/ai-provider", json={
            "active_provider": "ollama",
            "ollama": {"llm_base_url": "http://localhost:11434/v1", "llm_model": "mistral"},
        })

    assert r.status_code == 200
    save_session.commit.assert_awaited_once()


async def test_put_ai_provider_preserves_secret_when_not_provided(client: httpx.AsyncClient):
    rows = _make_ai_rows(active="external")
    load_session = _make_ai_session(rows)
    save_session = AsyncMock()
    save_session.__aenter__ = AsyncMock(return_value=save_session)
    save_session.__aexit__ = AsyncMock(return_value=False)
    save_session.execute = AsyncMock()
    save_session.commit = AsyncMock()

    # Build a second load_session for the response read after save
    load_session2 = _make_ai_session(rows)

    upsert_calls = []
    async def _capture_execute(stmt):
        upsert_calls.append(stmt)
        return MagicMock()

    save_session.execute = _capture_execute

    with patch("app.routers.ai_provider.SessionLocal", side_effect=[save_session, load_session2]):
        # Send external update without ai_client_secret — should keep existing
        r = await client.put("/v1/ai-provider", json={
            "active_provider": "external",
            "external": {
                "ai_client_id": "new-id",
                "ai_auth_url": "https://auth.new.com/oauth/token",
                "ai_api_url": "https://api.new.com",
                "ai_deployment_id": "new-deploy",
                "ai_resource_group": "prod",
            },
        })

    assert r.status_code == 200


# ---------------------------------------------------------------------------
# POST /v1/ai-provider/test
# ---------------------------------------------------------------------------

async def test_test_connection_stub_always_succeeds(client: httpx.AsyncClient):
    session = _make_ai_session(_make_ai_rows(active="stub"))
    with patch("app.routers.ai_provider.SessionLocal", return_value=session):
        r = await client.post("/v1/ai-provider/test")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert "Stub" in body["message"]


async def test_test_connection_ollama_success(client: httpx.AsyncClient):
    session = _make_ai_session(_make_ai_rows(active="ollama"))
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with (
        patch("app.routers.ai_provider.SessionLocal", return_value=session),
        patch("httpx.AsyncClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            get=AsyncMock(return_value=mock_resp)
        ))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        r = await client.post("/v1/ai-provider/test")

    assert r.status_code == 200
    assert r.json()["success"] is True


async def test_test_connection_ollama_connect_error(client: httpx.AsyncClient):
    import httpx as _httpx
    session = _make_ai_session(_make_ai_rows(active="ollama"))

    with (
        patch("app.routers.ai_provider.SessionLocal", return_value=session),
        patch("httpx.AsyncClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            get=AsyncMock(side_effect=_httpx.ConnectError("refused"))
        ))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        r = await client.post("/v1/ai-provider/test")

    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert "refused" in body["message"].lower() or "connection" in body["message"].lower()


async def test_test_connection_ollama_timeout(client: httpx.AsyncClient):
    import httpx as _httpx
    session = _make_ai_session(_make_ai_rows(active="ollama"))

    with (
        patch("app.routers.ai_provider.SessionLocal", return_value=session),
        patch("httpx.AsyncClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            get=AsyncMock(side_effect=_httpx.TimeoutException("timeout"))
        ))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        r = await client.post("/v1/ai-provider/test")

    assert r.status_code == 200
    assert r.json()["success"] is False
    assert "timed out" in r.json()["message"].lower()


async def test_test_connection_external_success(client: httpx.AsyncClient):
    session = _make_ai_session(_make_ai_rows(active="external"))
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"access_token": "tok123", "expires_in": 3600}

    with (
        patch("app.routers.ai_provider.SessionLocal", return_value=session),
        patch("httpx.AsyncClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            post=AsyncMock(return_value=mock_resp)
        ))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        r = await client.post("/v1/ai-provider/test")

    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert "token" in body["message"].lower()


async def test_test_connection_external_auth_failure(client: httpx.AsyncClient):
    session = _make_ai_session(_make_ai_rows(active="external"))
    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_resp.json.return_value = {}

    with (
        patch("app.routers.ai_provider.SessionLocal", return_value=session),
        patch("httpx.AsyncClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            post=AsyncMock(return_value=mock_resp)
        ))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        r = await client.post("/v1/ai-provider/test")

    assert r.status_code == 200
    assert r.json()["success"] is False
    assert "401" in r.json()["message"]


async def test_test_connection_external_missing_credentials(client: httpx.AsyncClient):
    # Remove credentials from rows
    rows = _make_ai_rows(active="external")
    for row in rows:
        if row.key in ("ai_client_id", "ai_client_secret", "ai_auth_url"):
            row.value = None
    session = _make_ai_session(rows)

    with patch("app.routers.ai_provider.SessionLocal", return_value=session):
        r = await client.post("/v1/ai-provider/test")

    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert "required" in body["message"].lower() or "save" in body["message"].lower()
