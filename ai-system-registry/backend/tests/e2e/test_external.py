"""E2E tests for the external read API (/v1/external/*) — a bearer-token-guarded,
read-only surface for off-platform consumers. In-process via ASGITransport.

The external endpoints use the bearer gate (require_external_token), not the
OpenFGA model the e2e harness stubs out, so these exercise the real auth. The
token is read from the env at call time, so monkeypatch.setenv controls it.
"""

from __future__ import annotations

import json as _json

import httpx
import respx

_ASSIGNEE = "engineer1"
_HEADERS = {"x-forwarded-preferred-username": _ASSIGNEE}
_TOKEN = "test-external-token"
_AUTH = {"Authorization": f"Bearer {_TOKEN}"}

# external.py reads this default at import time (the e2e env does not override it).
_RETRIEVE_URL = "http://document-indexing-backend:8011/v1/retrieve"


async def _create_system(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Ext Test System", "assignee_username": _ASSIGNEE},
        headers=_HEADERS,
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


async def test_503_when_token_unset(client, monkeypatch):
    monkeypatch.delenv("EXTERNAL_API_TOKEN", raising=False)
    r = await client.get("/v1/external/systems", headers=_AUTH)
    assert r.status_code == 503


async def test_missing_header_401(client, monkeypatch):
    monkeypatch.setenv("EXTERNAL_API_TOKEN", _TOKEN)
    r = await client.get("/v1/external/systems")
    assert r.status_code == 401


async def test_wrong_token_401(client, monkeypatch):
    monkeypatch.setenv("EXTERNAL_API_TOKEN", _TOKEN)
    r = await client.get(
        "/v1/external/systems", headers={"Authorization": "Bearer nope"}
    )
    assert r.status_code == 401


async def test_list_and_get_systems(client, monkeypatch):
    monkeypatch.setenv("EXTERNAL_API_TOKEN", _TOKEN)
    sid = await _create_system(client)

    r = await client.get("/v1/external/systems", headers=_AUTH)
    assert r.status_code == 200
    assert any(s["id"] == sid for s in r.json())

    r = await client.get(f"/v1/external/systems/{sid}", headers=_AUTH)
    assert r.status_code == 200
    assert r.json()["id"] == sid

    r = await client.get("/v1/external/systems/SYS-NOPE", headers=_AUTH)
    assert r.status_code == 404


async def test_assessment_shape(client, monkeypatch):
    monkeypatch.setenv("EXTERNAL_API_TOKEN", _TOKEN)
    sid = await _create_system(client)

    r = await client.get(f"/v1/external/systems/{sid}/assessment", headers=_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["ai_system_id"] == sid
    assert set(body["classification"].keys()) == {"tier", "basis", "annex_iii_area"}
    assert "justification" in body


async def test_context_injects_system_id_and_principal(client, monkeypatch):
    monkeypatch.setenv("EXTERNAL_API_TOKEN", _TOKEN)
    sid = await _create_system(client)

    # assert_all_mocked=False lets the ASGITransport call to the app pass through;
    # only the outbound document-indexing call is mocked.
    with respx.mock(assert_all_mocked=False) as mock:
        route = mock.post(_RETRIEVE_URL).mock(
            return_value=httpx.Response(
                200, json=[{"chunk_id": "CHNK-1", "passage": "x"}]
            )
        )
        r = await client.post(
            f"/v1/external/systems/{sid}/context",
            headers=_AUTH,
            json={"query": "risk tier", "k": 3, "mode": "dense"},
        )

    assert r.status_code == 200
    assert r.json()[0]["chunk_id"] == "CHNK-1"

    sent = route.calls.last.request
    payload = _json.loads(sent.content)
    assert payload["ai_system_id"] == sid
    assert payload["query"] == "risk tier"
    assert payload["k"] == 3
    assert sent.headers["x-forwarded-preferred-username"] == "svc-external-api"


async def test_context_rejects_empty_query(client, monkeypatch):
    monkeypatch.setenv("EXTERNAL_API_TOKEN", _TOKEN)
    sid = await _create_system(client)
    r = await client.post(
        f"/v1/external/systems/{sid}/context", headers=_AUTH, json={"query": ""}
    )
    assert r.status_code == 422


async def test_context_unknown_system_404(client, monkeypatch):
    monkeypatch.setenv("EXTERNAL_API_TOKEN", _TOKEN)
    r = await client.post(
        "/v1/external/systems/SYS-NOPE/context",
        headers=_AUTH,
        json={"query": "risk tier"},
    )
    assert r.status_code == 404
