"""Scenario 1 — AI System Registration.

1a. AI Engineer registers a system via the manual_questionnaire flow through the shell proxy.
    Uses deterministic flag-based classification (is_critical_infrastructure → tier "high").
1b. AI-assisted registration: POST a turn and a document-extract through the assist endpoints.
    Structural assertions only (no LLM value checks) — works on stub, ollama, and external.
"""

from __future__ import annotations

import os

from conftest import BUSINESS_ANSWERS, register_system

# ---------------------------------------------------------------------------
# 1a — manual_questionnaire registration
# ---------------------------------------------------------------------------


async def test_engineer_registers_system(engineer):
    """An AI Engineer can register a system end-to-end; deterministic tier from flags.

    Intake always creates a tier="pending" stub. The tier is resolved by PUT-ing risk
    flags (which triggers the deterministic classifier). is_critical_infrastructure is an
    Annex III flag → tier "high" (see classifier.py priority table).
    """
    # Step 1: register — intake always returns tier="pending"
    system = await register_system(engineer, name="E2E Reg 1a")
    assert system["id"].startswith("SYS-"), f"unexpected id format: {system['id']}"
    assert (
        system["tier"] == "pending"
    ), f"fresh intake should be 'pending', got {system['tier']!r}"

    sid = system["id"]

    # Step 2: set risk flag + business answers via PUT — triggers classify()
    upd = await engineer.put(
        f"/api/registry/v1/systems/{sid}",
        json={
            "is_critical_infrastructure": True,
            "questionnaire_answers": BUSINESS_ANSWERS,
        },
    )
    assert (
        upd.status_code == 200
    ), f"PUT flags failed: {upd.status_code} {upd.text[:400]}"
    updated = upd.json()
    assert (
        updated["tier"] == "high"
    ), f"is_critical_infrastructure=True must yield tier 'high', got {updated['tier']!r}"

    # Step 3: verify persisted state
    r = await engineer.get(f"/api/registry/v1/systems/{sid}")
    assert r.status_code == 200, f"GET system failed: {r.status_code} {r.text[:200]}"
    got = r.json()
    assert got["tier"] == "high"
    assert got["workflow_status"] == "draft"


# ---------------------------------------------------------------------------
# 1b — AI-assisted registration (structural assertions)
# ---------------------------------------------------------------------------


async def test_ai_assisted_turn(engineer):
    """POST an initial assist turn; assert the response has the expected shape."""
    r = await engineer.post(
        "/api/registry/v1/intake/assist/turn",
        json={"transcript": [], "fields": {}},
    )
    assert r.status_code == 200, f"assist/turn failed: {r.status_code} {r.text[:400]}"
    body = r.json()
    assert (
        "message" in body
    ), f"missing 'message' in assist/turn response: {body.keys()}"
    assert "extracted_fields" in body, f"missing 'extracted_fields': {body.keys()}"
    assert "complete" in body, f"missing 'complete': {body.keys()}"
    assert body["message"], "assist/turn returned an empty message"


async def test_ai_assisted_extract(engineer):
    """Upload a plain-text document to assist/extract; assert extracted_fields is a dict."""
    fixture = os.path.join(
        os.path.dirname(__file__), "fixtures", "sample_system_doc.txt"
    )
    file_bytes = open(fixture, "rb").read()  # noqa: ASYNC230, SIM115
    r = await engineer.post(
        "/api/registry/v1/intake/assist/extract",
        files={"file": ("sample_system_doc.txt", file_bytes, "text/plain")},
    )
    assert (
        r.status_code == 200
    ), f"assist/extract failed: {r.status_code} {r.text[:400]}"
    body = r.json()
    assert "extracted_fields" in body, f"missing 'extracted_fields': {body.keys()}"
    assert isinstance(
        body["extracted_fields"], dict
    ), f"extracted_fields should be a dict, got {type(body['extracted_fields'])}"
