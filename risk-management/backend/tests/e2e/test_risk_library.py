"""E2E tests for /v1/risk-library endpoints: basic CRUD + stats."""
from __future__ import annotations


async def test_risk_library_editable_defaults_true_when_admin_backend_unreachable(client):
    """Fail-open by design: risk-library-editable is a soft governance gate,
    not a security control, so an unreachable admin backend must not block it.
    """
    r = await client.get("/v1/settings/risk-library-editable")
    assert r.status_code == 200, r.text
    assert r.json()["risk_library_editable"] is True


async def test_create_and_list_library_risk(client):
    r = await client.post(
        "/v1/risk-library",
        json={"title": "Library risk", "category": "bias", "severity": "high", "likelihood": "likely"},
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["title"] == "Library risk"
    assert created["incidents"] == []

    r = await client.get("/v1/risk-library")
    assert r.status_code == 200, r.text
    assert any(row["id"] == created["id"] for row in r.json())

    r = await client.get(f"/v1/risk-library/{created['id']}")
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Library risk"


async def test_library_risk_stats_with_no_linked_systems(client):
    r = await client.post("/v1/risk-library", json={"title": "Unlinked risk"})
    assert r.status_code == 201, r.text
    risk_id = r.json()["id"]

    r = await client.get(f"/v1/risk-library/{risk_id}/stats")
    assert r.status_code == 200, r.text
    stats = r.json()
    assert stats["dominant_severity"] is None
    assert stats["dominant_likelihood"] is None
    assert stats["linked_systems"] == []
