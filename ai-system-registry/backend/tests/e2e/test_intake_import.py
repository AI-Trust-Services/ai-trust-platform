"""E2E tests for POST /v1/intake/batch — batch AI-system import."""

from __future__ import annotations

import json

import httpx
import pytest

_HEADERS = {"x-forwarded-preferred-username": "test-user"}


def _upload(records: list, target_status: str = "draft"):
    """Build multipart payload matching the endpoint signature."""
    return {
        "files": {
            "file": ("systems.json", json.dumps(records).encode(), "application/json")
        },
        "data": {"target_status": target_status},
    }


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


async def test_import_valid_classified_system_approved(client: httpx.AsyncClient):
    """Three records with tier + target_status=approved all land as approved/full_manual."""
    records = [
        {"name": "Fraud model", "tier": "high", "annex_iii_area": 5},
        {"name": "HR screening tool", "tier": "high", "is_employment_related": True},
        {"name": "Internal chatbot", "tier": "limited", "is_chatbot": True},
    ]
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        **_upload(records, target_status="approved"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 3
    assert body["failed"] == []

    # Verify persisted state — only assert on the systems this test created.
    systems = await client.get("/v1/systems", headers=_HEADERS)
    items = {s["name"]: s for s in systems.json()}
    for name in ("Fraud model", "HR screening tool", "Internal chatbot"):
        assert items[name]["workflow_status"] == "approved"
        assert items[name]["registration_mode"] == "full_manual"
    assert items["Fraud model"]["tier"] == "high"
    assert items["Fraud model"]["annex_iii_area"] == 5
    assert items["HR screening tool"]["is_employment_related"] is True
    assert items["Internal chatbot"]["tier"] == "limited"


async def test_import_tier_less_record_rejected_when_targeting_approved(
    client: httpx.AsyncClient,
):
    """A tier-less record with target_status=approved is rejected, not silently downgraded."""
    records = [{"name": "Unknown risk system"}]
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        **_upload(records, target_status="approved"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 0
    assert len(body["failed"]) == 1
    assert body["failed"][0]["name"] == "Unknown risk system"
    assert "tier" in body["failed"][0]["error"]

    # Verify the system was NOT inserted.
    systems = await client.get("/v1/systems", headers=_HEADERS)
    names = [s["name"] for s in systems.json()]
    assert "Unknown risk system" not in names


async def test_import_partial_success(client: httpx.AsyncClient):
    """Valid and invalid records in one batch: valid inserted, invalid reported."""
    records = [
        {"name": "Good system", "tier": "minimal"},
        {"name": "Bad tier system", "tier": "super-high"},  # invalid tier
        {
            "name": "Bad url system",
            "application_url": "javascript:alert(1)",
        },  # invalid scheme
        {"name": "Another good one", "tier": "limited", "is_chatbot": True},
    ]
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        **_upload(records),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 2
    assert len(body["failed"]) == 2
    failed_indices = {f["index"] for f in body["failed"]}
    assert failed_indices == {1, 2}


async def test_import_classifier_flags_stored(client: httpx.AsyncClient):
    """Classifier flags are stored as-is (evidential, not recomputed)."""
    records = [{"name": "HR tool", "tier": "high", "is_employment_related": True}]
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        **_upload(records),
    )
    assert r.status_code == 200

    systems = await client.get("/v1/systems", headers=_HEADERS)
    s = next(x for x in systems.json() if x["name"] == "HR tool")
    assert s["is_employment_related"] is True


async def test_import_unknown_keys_ignored(client: httpx.AsyncClient):
    """Extra keys from a foreign source do not cause validation failure."""
    records = [
        {"name": "Foreign system", "cost_center": "HR-42", "internal_ref": "abc"}
    ]
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        **_upload(records),
    )
    assert r.status_code == 200
    assert r.json()["imported"] == 1


# ---------------------------------------------------------------------------
# Security guards
# ---------------------------------------------------------------------------


async def test_import_rejects_javascript_url(client: httpx.AsyncClient):
    """application_url with javascript: scheme is rejected."""
    records = [{"name": "XSS attempt", "application_url": "javascript:alert(1)"}]
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        **_upload(records),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 0
    assert body["failed"][0]["index"] == 0


async def test_import_rejects_too_many_records(client: httpx.AsyncClient):
    """Batches exceeding MAX_IMPORT_RECORDS (1000) are rejected with 413."""
    records = [{"name": f"System {i}"} for i in range(1001)]
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        **_upload(records),
    )
    assert r.status_code == 413


async def test_import_rejects_non_list_json(client: httpx.AsyncClient):
    """A JSON object (not array) at root is rejected with 422."""
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        files={"file": ("systems.json", b'{"name": "single"}', "application/json")},
        data={"target_status": "draft"},
    )
    assert r.status_code == 422


async def test_import_rejects_invalid_target_status(client: httpx.AsyncClient):
    """An invalid target_status value is rejected with 422."""
    records = [{"name": "Test"}]
    r = await client.post(
        "/v1/intake/batch",
        headers=_HEADERS,
        **_upload(records, target_status="published"),
    )
    assert r.status_code == 422
