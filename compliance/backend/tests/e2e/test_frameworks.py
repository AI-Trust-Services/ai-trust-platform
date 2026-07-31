"""E2E tests for GET/PATCH /v1/frameworks."""
from __future__ import annotations

import httpx


async def test_list_frameworks_returns_seeded_data(client: httpx.AsyncClient):
    r = await client.get("/v1/frameworks")
    assert r.status_code == 200
    ids = {f["id"] for f in r.json()}
    assert "FRM-EU-AI-ACT" in ids
    assert "FRM-NIST-AI-RMF" in ids
    assert "FRM-ISO-42001" in ids


async def test_get_framework_by_id(client: httpx.AsyncClient):
    r = await client.get("/v1/frameworks/FRM-EU-AI-ACT")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "FRM-EU-AI-ACT"
    assert body["name"] == "EU AI Act"
    assert body["enabled"] is True


async def test_get_framework_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/v1/frameworks/FRM-UNKNOWN")
    assert r.status_code == 404


async def test_disable_framework(client: httpx.AsyncClient):
    r = await client.patch("/v1/frameworks/FRM-ISO-42001", json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["enabled"] is False

    # Re-enable so the framework is available for subsequent tests in same run
    await client.patch("/v1/frameworks/FRM-ISO-42001", json={"enabled": True})


async def test_enable_framework(client: httpx.AsyncClient):
    await client.patch("/v1/frameworks/FRM-ISO-42001", json={"enabled": False})
    r = await client.patch("/v1/frameworks/FRM-ISO-42001", json={"enabled": True})
    assert r.status_code == 200
    assert r.json()["enabled"] is True


async def test_patch_framework_404_on_missing(client: httpx.AsyncClient):
    r = await client.patch("/v1/frameworks/FRM-UNKNOWN", json={"enabled": False})
    assert r.status_code == 404
