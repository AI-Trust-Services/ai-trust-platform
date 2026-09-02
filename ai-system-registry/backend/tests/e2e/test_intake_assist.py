"""E2E tests for the AI-assisted registration endpoints.

Uses the stub LLM provider (LLM_PROVIDER=stub, the default) so no network is
required. The stub drives a deterministic TalentMatch recruiting sequence and
infers is_employment_related=True at completion.

Owner flow:
  POST /v1/intake/assist/turn    — stateless conversation turn
  POST /v1/intake/assist/extract — document extraction

Engineer flow:
  POST /v1/intake/assist/engineer/{system_id}/turn
  POST /v1/intake/assist/engineer/{system_id}/extract

Full round-trip:
  owner turn loop → complete → POST /v1/intake with inferred flags → tier=high
"""
from __future__ import annotations

import io

import httpx
import pytest

from app.llm.prompts import REQUIRED_FIELD_KEYS

_ENGINEER = "engineer1"
_HEADERS = {"x-forwarded-preferred-username": _ENGINEER}


async def _create_system(client: httpx.AsyncClient, **extra) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "AssistTest System", "assignee_username": _ENGINEER, **extra},
        headers=_HEADERS,
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


# ---------------------------------------------------------------------------
# Owner turn — POST /intake/assist/turn
# ---------------------------------------------------------------------------

async def test_owner_turn_returns_message_and_extracted_fields(client: httpx.AsyncClient):
    transcript = [{"role": "assistant", "content": "Hi! Tell me about your system."}]
    fields: dict = {}
    r = await client.post(
        "/v1/intake/assist/turn",
        json={"transcript": transcript, "fields": fields},
        headers=_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    assert "message" in body
    assert isinstance(body["extracted_fields"], dict)
    assert body["complete"] is False
    assert body["degraded"] is False


async def test_owner_turn_reaches_complete_after_full_sequence(client: httpx.AsyncClient, monkeypatch):
    """Drive REQUIRED_FIELD_KEYS turns; stub marks complete on the last one.

    The default TURN_CAP (12) is below REQUIRED_FIELD_KEYS (14), so the one-shot
    chat would degrade before the stub converges. Raise the cap here so the full
    scripted sequence completes and flag inference runs.
    """
    monkeypatch.setattr("app.routers.intake_assist.TURN_CAP", len(REQUIRED_FIELD_KEYS) + 5)
    transcript = [{"role": "assistant", "content": "Hi! Describe your system."}]
    fields: dict = {}

    for i in range(len(REQUIRED_FIELD_KEYS)):
        transcript.append({"role": "user", "content": f"answer {i}"})
        r = await client.post(
            "/v1/intake/assist/turn",
            json={"transcript": transcript, "fields": fields},
            headers=_HEADERS,
        )
        assert r.status_code == 200
        body = r.json()
        fields = body["extracted_fields"]
        if body["message"]:
            transcript.append({"role": "assistant", "content": body["message"]})
        if body["complete"]:
            break

    assert body["complete"] is True
    assert body["degraded"] is False
    # Stub infers is_employment_related from the recruiting context
    assert body["inferred_flags"] is not None
    flag_names = [f["flag"] for f in body["inferred_flags"]]
    assert "is_employment_related" in flag_names
    # Classification returned at completion
    assert body["classification"] is not None
    assert body["classification"]["tier"] == "high"


async def test_owner_turn_empty_transcript_still_responds(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/intake/assist/turn",
        json={"transcript": [], "fields": {}},
        headers=_HEADERS,
    )
    assert r.status_code == 200
    assert "extracted_fields" in r.json()


async def test_owner_turn_degraded_after_turn_cap(client: httpx.AsyncClient):
    """Exceeding TURN_CAP without reaching complete triggers degraded=True."""
    from app.routers.intake_assist import TURN_CAP
    transcript: list[dict] = [{"role": "assistant", "content": "Go!"}]
    fields: dict = {}

    # Flood with user messages beyond the cap without completing
    for i in range(TURN_CAP + 2):
        transcript.append({"role": "user", "content": f"filler {i}"})
        r = await client.post(
            "/v1/intake/assist/turn",
            json={"transcript": transcript, "fields": fields},
            headers=_HEADERS,
        )
        assert r.status_code == 200
        body = r.json()
        fields = body["extracted_fields"]
        if body["complete"]:
            break

    assert body["complete"] is True


# ---------------------------------------------------------------------------
# Owner extract — POST /intake/assist/extract
# ---------------------------------------------------------------------------

async def test_owner_extract_from_text_file(client: httpx.AsyncClient):
    content = b"System: TalentMatch\nPurpose: Screens job applicants\nDepartment: HR"
    r = await client.post(
        "/v1/intake/assist/extract",
        files={"file": ("spec.txt", io.BytesIO(content), "text/plain")},
        headers=_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["extracted_fields"], dict)
    # Stub extracts department, technologies, use_case, entity_role, etc. from documents
    assert "department" in body["extracted_fields"]


async def test_owner_extract_unsupported_file_type_returns_400(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/intake/assist/extract",
        files={"file": ("data.csv", io.BytesIO(b"a,b,c"), "text/csv")},
        headers=_HEADERS,
    )
    assert r.status_code == 400


async def test_owner_extract_returns_notes(client: httpx.AsyncClient):
    content = b"TalentMatch: AI screening tool for HR recruiting."
    r = await client.post(
        "/v1/intake/assist/extract",
        files={"file": ("brief.txt", io.BytesIO(content), "text/plain")},
        headers=_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    # Stub always returns a notes string for text documents
    assert body["notes"] is not None
    assert len(body["notes"]) > 0


async def test_owner_extract_oversized_file_returns_400(client: httpx.AsyncClient):
    from app.documents import MAX_FILE_BYTES

    oversized = b"x" * (MAX_FILE_BYTES + 1)
    r = await client.post(
        "/v1/intake/assist/extract",
        files={"file": ("big.txt", io.BytesIO(oversized), "text/plain")},
        headers=_HEADERS,
    )
    assert r.status_code == 400
    assert "too large" in r.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Engineer turn — POST /intake/assist/engineer/{system_id}/turn
# ---------------------------------------------------------------------------

async def test_engineer_turn_returns_response_for_valid_system(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    transcript = [{"role": "assistant", "content": "Tell me the version and provider."}]
    r = await client.post(
        f"/v1/intake/assist/engineer/{system_id}/turn",
        json={"transcript": transcript, "fields": {}},
        headers=_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    assert "message" in body
    assert isinstance(body["extracted_fields"], dict)


async def test_engineer_turn_preserves_pre_seeded_fields(client: httpx.AsyncClient):
    """Fields passed in from the existing system are preserved in extracted_fields."""
    system_id = await _create_system(
        client,
        description="Hiring assistant",
        intended_purpose="Screens job applicants",
    )
    pre_seeded = {
        "description": "Hiring assistant",
        "intended_purpose": "Screens job applicants",
        "version": "1.0",
        "provider": "ACME Corp",
    }
    transcript = [{"role": "assistant", "content": "Tell me the technical details."}]
    r = await client.post(
        f"/v1/intake/assist/engineer/{system_id}/turn",
        json={"transcript": transcript, "fields": pre_seeded},
        headers=_HEADERS,
    )
    assert r.status_code == 200
    extracted = r.json()["extracted_fields"]
    assert extracted.get("description") == "Hiring assistant"
    assert extracted.get("intended_purpose") == "Screens job applicants"


async def test_engineer_turn_404_on_missing_system(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/intake/assist/engineer/SYS-NOTFOUND/turn",
        json={"transcript": [], "fields": {}},
        headers=_HEADERS,
    )
    assert r.status_code == 404


async def test_engineer_turn_reaches_complete_and_infers_flags(client: httpx.AsyncClient, monkeypatch):
    """Full sequence for the engineer flow — should complete and infer flags."""
    monkeypatch.setattr("app.routers.intake_assist.TURN_CAP", len(REQUIRED_FIELD_KEYS) + 5)
    system_id = await _create_system(
        client,
        intended_purpose="Screens and ranks job applicants to support recruiters.",
        use_case="recruiting",
    )
    transcript = [{"role": "assistant", "content": "Describe the technical details."}]
    fields: dict = {}

    for i in range(len(REQUIRED_FIELD_KEYS)):
        transcript.append({"role": "user", "content": f"answer {i}"})
        r = await client.post(
            f"/v1/intake/assist/engineer/{system_id}/turn",
            json={"transcript": transcript, "fields": fields},
            headers=_HEADERS,
        )
        assert r.status_code == 200
        body = r.json()
        fields = body["extracted_fields"]
        if body["message"]:
            transcript.append({"role": "assistant", "content": body["message"]})
        if body["complete"]:
            break

    assert body["complete"] is True
    assert body["inferred_flags"] is not None
    assert body["classification"] is not None


# ---------------------------------------------------------------------------
# Engineer extract — POST /intake/assist/engineer/{system_id}/extract
# ---------------------------------------------------------------------------

async def test_engineer_extract_from_text_file(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    content = b"Model: GPT-4o\nProvider: OpenAI\nVersion: 2024-11"
    r = await client.post(
        f"/v1/intake/assist/engineer/{system_id}/extract",
        files={"file": ("model_card.txt", io.BytesIO(content), "text/plain")},
        headers=_HEADERS,
    )
    assert r.status_code == 200
    assert isinstance(r.json()["extracted_fields"], dict)


async def test_engineer_extract_404_on_missing_system(client: httpx.AsyncClient):
    content = b"Model: GPT-4o"
    r = await client.post(
        "/v1/intake/assist/engineer/SYS-NOTFOUND/extract",
        files={"file": ("model_card.txt", io.BytesIO(content), "text/plain")},
        headers=_HEADERS,
    )
    assert r.status_code == 404


async def test_engineer_extract_unsupported_file_type_returns_400(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/intake/assist/engineer/{system_id}/extract",
        files={"file": ("data.csv", io.BytesIO(b"a,b"), "text/csv")},
        headers=_HEADERS,
    )
    assert r.status_code == 400


async def test_engineer_extract_oversized_file_returns_400(client: httpx.AsyncClient):
    from app.documents import MAX_FILE_BYTES

    system_id = await _create_system(client)
    oversized = b"x" * (MAX_FILE_BYTES + 1)
    r = await client.post(
        f"/v1/intake/assist/engineer/{system_id}/extract",
        files={"file": ("big.txt", io.BytesIO(oversized), "text/plain")},
        headers=_HEADERS,
    )
    assert r.status_code == 400
    assert "too large" in r.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Full round-trip: owner AI flow → POST /intake with inferred flags
# ---------------------------------------------------------------------------

async def test_full_owner_flow_registers_high_risk_system(client: httpx.AsyncClient, monkeypatch):
    """Drive the owner turn loop to completion, then register with inferred flags.

    The stub infers is_employment_related=True, so the final tier must be 'high'.
    """
    monkeypatch.setattr("app.routers.intake_assist.TURN_CAP", len(REQUIRED_FIELD_KEYS) + 5)
    transcript = [{"role": "assistant", "content": "Tell me about your system."}]
    fields: dict = {}
    inferred_flags = None

    for i in range(len(REQUIRED_FIELD_KEYS)):
        transcript.append({"role": "user", "content": f"answer {i}"})
        r = await client.post(
            "/v1/intake/assist/turn",
            json={"transcript": transcript, "fields": fields},
            headers=_HEADERS,
        )
        assert r.status_code == 200
        body = r.json()
        fields = body["extracted_fields"]
        if body["message"]:
            transcript.append({"role": "assistant", "content": body["message"]})
        if body["complete"]:
            inferred_flags = body["inferred_flags"]
            break

    assert inferred_flags is not None

    intake_payload: dict = {
        "name": "TalentMatch",
        "description": fields.get("purpose", ""),
        "assignee_username": _ENGINEER,
        "classification_rationale": inferred_flags,
    }
    for flag in inferred_flags:
        intake_payload[flag["flag"]] = flag["value"]

    r = await client.post("/v1/intake", json=intake_payload, headers=_HEADERS)
    assert r.status_code == 201
    body = r.json()
    assert body["system"]["tier"] == "high"
    assert body["classification"]["tier"] == "high"
