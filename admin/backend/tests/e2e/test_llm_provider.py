"""E2E tests for the bring-your-own-LLM provider admin API (issue #406).

Full ASGI stack against the test Postgres. The outbound Test Connection probe
(``_probe``) is patched — these tests pin the admin-side state machine (masking,
SSRF validation, test-before-activate gating, activate/deactivate), not a real
LLM endpoint.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio

_BASE = "/v1/llm-provider"
_OK_PROBE = AsyncMock(return_value=(True, "Connection OK — model 'm' responded."))
_FAIL_PROBE = AsyncMock(
    return_value=(False, "Authentication failed — check the API token.")
)


async def _put(client, **fields):
    return await client.put(_BASE, json=fields)


async def test_get_defaults_to_empty_inactive(client):
    r = await client.get(_BASE)
    assert r.status_code == 200
    body = r.json()
    assert body["base_url"] is None
    assert body["has_token"] is False
    assert body["is_active"] is False
    # platform_default_live reflects THALAMUS_BASE_URL; always present.
    assert "platform_default_live" in body


async def test_platform_default_live_reflects_thalamus_env(client, monkeypatch):
    # Real gateway → live (no silent-stub warning).
    monkeypatch.setenv("THALAMUS_BASE_URL", "https://thalamus.example.com/v1")
    assert (await client.get(_BASE)).json()["platform_default_live"] is True
    # Stub / unset → not live (admin UI warns when no BYO active).
    monkeypatch.setenv("THALAMUS_BASE_URL", "stub")
    assert (await client.get(_BASE)).json()["platform_default_live"] is False
    monkeypatch.setenv("THALAMUS_BASE_URL", "")
    assert (await client.get(_BASE)).json()["platform_default_live"] is False


async def test_put_stores_config_and_masks_token(client):
    r = await _put(
        client,
        base_url="https://api.example.com/v1",
        model="gpt-x",
        api_token="secret-token",
    )
    assert r.status_code == 200
    body = r.json()
    assert body["base_url"] == "https://api.example.com/v1"
    assert body["model"] == "gpt-x"
    assert body["has_token"] is True
    # The token itself must never be returned.
    assert "secret-token" not in r.text
    assert "api_token" not in body


async def test_put_preserves_token_when_omitted(client):
    await _put(client, base_url="https://api.example.com/v1", model="m", api_token="t1")
    # Second PUT without a token keeps the stored one.
    r = await _put(client, base_url="https://api.example.com/v1", model="m2")
    assert r.json()["has_token"] is True
    assert r.json()["model"] == "m2"


async def test_put_rejects_internal_url(client):
    r = await _put(
        client, base_url="http://169.254.169.254/v1", model="m", api_token="t"
    )
    assert r.status_code == 422  # SSRF guard


async def test_put_rejects_non_https(client):
    r = await _put(
        client, base_url="http://api.example.com/v1", model="m", api_token="t"
    )
    assert r.status_code == 422


async def test_activate_requires_a_passing_test(client):
    await _put(client, base_url="https://api.example.com/v1", model="m", api_token="t")
    # No test run yet → activation refused.
    r = await client.post(f"{_BASE}/activate")
    assert r.status_code == 422
    assert "Test Connection" in r.json()["detail"]


async def test_test_then_activate_flow(client):
    await _put(client, base_url="https://api.example.com/v1", model="m", api_token="t")
    with patch("app.routers.llm_provider._probe", _OK_PROBE):
        tr = await client.post(f"{_BASE}/test", json={})
    assert tr.json()["success"] is True

    ar = await client.post(f"{_BASE}/activate")
    assert ar.status_code == 200
    assert ar.json()["is_active"] is True
    assert ar.json()["last_test_status"] == "ok"


async def test_failed_test_blocks_activation(client):
    await _put(client, base_url="https://api.example.com/v1", model="m", api_token="t")
    with patch("app.routers.llm_provider._probe", _FAIL_PROBE):
        tr = await client.post(f"{_BASE}/test", json={})
    assert tr.json()["success"] is False

    r = await client.post(f"{_BASE}/activate")
    assert r.status_code == 422


async def test_put_after_passing_test_reinvalidates(client):
    """Changing config after a passing test must reset activation + test status."""
    await _put(client, base_url="https://api.example.com/v1", model="m", api_token="t")
    with patch("app.routers.llm_provider._probe", _OK_PROBE):
        await client.post(f"{_BASE}/test", json={})
    await client.post(f"{_BASE}/activate")

    # Edit the model → deactivated, test status cleared.
    r = await _put(
        client, base_url="https://api.example.com/v1", model="m-new", api_token="t"
    )
    assert r.json()["is_active"] is False
    assert r.json()["last_test_status"] is None

    # And activation is blocked again until re-tested.
    r2 = await client.post(f"{_BASE}/activate")
    assert r2.status_code == 422


async def test_deactivate_restores_default(client):
    await _put(client, base_url="https://api.example.com/v1", model="m", api_token="t")
    with patch("app.routers.llm_provider._probe", _OK_PROBE):
        await client.post(f"{_BASE}/test", json={})
    await client.post(f"{_BASE}/activate")

    r = await client.post(f"{_BASE}/deactivate")
    assert r.status_code == 200
    assert r.json()["is_active"] is False
    # Config is retained (not deleted) — just inactive.
    assert r.json()["base_url"] == "https://api.example.com/v1"
    assert r.json()["has_token"] is True


async def test_test_requires_complete_config(client):
    # No stored row and empty body → cannot test.
    r = await client.post(f"{_BASE}/test", json={})
    assert r.json()["success"] is False
    assert "required" in r.json()["message"].lower()


async def test_test_rejects_internal_candidate_url(client):
    r = await client.post(
        f"{_BASE}/test",
        json={"base_url": "http://127.0.0.1/v1", "model": "m", "api_token": "t"},
    )
    assert r.json()["success"] is False


# --- health endpoint (read-only active-provider probe) ---------------------


async def _activate(client):
    """Put + pass test + activate a provider so /health has something to probe."""
    await _put(client, base_url="https://api.example.com/v1", model="m", api_token="t")
    with patch("app.routers.llm_provider._probe", _OK_PROBE):
        await client.post(f"{_BASE}/test", json={})
    await client.post(f"{_BASE}/activate")


async def test_health_inactive_returns_null_ok(client):
    r = await client.get(f"{_BASE}/health")
    assert r.status_code == 200
    assert r.json() == {"active": False, "ok": None, "message": None}


async def test_health_active_healthy(client):
    await _activate(client)
    with patch("app.routers.llm_provider._probe", _OK_PROBE):
        r = await client.get(f"{_BASE}/health")
    body = r.json()
    assert body["active"] is True
    assert body["ok"] is True


async def test_health_active_broken(client):
    await _activate(client)
    with patch("app.routers.llm_provider._probe", _FAIL_PROBE):
        r = await client.get(f"{_BASE}/health")
    body = r.json()
    assert body["active"] is True
    assert body["ok"] is False
    assert body["message"]


async def test_health_does_not_mutate_or_reset_activation(client):
    """A failing /health probe must NOT flip last_test_status or deactivate —
    unlike /test it is read-only, so a page-load probe can't churn state."""
    await _activate(client)
    with patch("app.routers.llm_provider._probe", _FAIL_PROBE):
        await client.get(f"{_BASE}/health")
    cfg = (await client.get(_BASE)).json()
    assert cfg["is_active"] is True  # still active
    assert cfg["last_test_status"] == "ok"  # unchanged by the health probe


# --- _probe status-code mapping (mocked httpx response) --------------------


def _mock_httpx_response(status_code: int, json_body=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=json_body if json_body is not None else {})
    return resp


async def _probe_with_status(status_code: int, json_body=None):
    from app.routers import llm_provider

    resp = _mock_httpx_response(status_code, json_body)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
    cm.__aexit__ = AsyncMock(return_value=False)
    with patch.object(llm_provider.httpx, "AsyncClient", return_value=cm):
        return await llm_provider._probe("https://api.example.com/v1", "tok", "m")


async def test_probe_429_is_rate_limit_message():
    ok, msg = await _probe_with_status(429)
    assert ok is False
    assert "429" in msg and "rate limit" in msg.lower()
    # It must read as "creds valid, retry", not as an auth/config error.
    assert "valid" in msg.lower()


async def test_probe_401_is_auth_message():
    ok, msg = await _probe_with_status(401)
    assert ok is False
    assert "authentication" in msg.lower()


async def test_probe_404_is_model_message():
    ok, msg = await _probe_with_status(404)
    assert ok is False
    assert "unavailable" in msg.lower()


async def test_probe_200_with_choices_succeeds():
    ok, msg = await _probe_with_status(
        200, {"choices": [{"message": {"content": "x"}}]}
    )
    assert ok is True


async def test_probe_200_without_choices_is_incompatible():
    ok, msg = await _probe_with_status(200, {"not": "openai"})
    assert ok is False
    assert "compatible" in msg.lower()
