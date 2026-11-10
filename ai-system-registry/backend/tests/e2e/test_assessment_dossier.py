"""E2E tests for the assessment dossier (issue #366).

The dossier is the immutable per-run snapshot: inputs/config/prompts are frozen
when the owner opens a fresh assessment cycle (POST /open), and the ``ai`` output
layer is appended once the background prefill+classification pipeline completes.
There is no read endpoint (dossier display is out of scope for #366), so these
tests assert against the DB directly via psycopg2 — the same driver the conftest
uses for setup/teardown.

Runs in stub LLM mode (THALAMUS_BASE_URL unset → stub); the pipeline's MinIO
upload is patched so no live MinIO is required (mirrors test_assessment.py).
"""

from __future__ import annotations

import os
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx
import psycopg2
import pytest

_OWNER = "owner1"
_TEST_DB = "ai_trust_test"


def _hdr(user: str) -> dict:
    return {"x-forwarded-preferred-username": user}


def _pg():
    """A raw psycopg2 connection to the test DB (JSONB is auto-parsed to dict)."""
    return psycopg2.connect(
        host="localhost",
        port=5432,
        user=os.environ.get("POSTGRES_USER", "postgres"),
        password=os.environ.get("POSTGRES_PASSWORD", "postgres"),
        dbname=_TEST_DB,
    )


async def _create_system(client: httpx.AsyncClient, name: str, description: str) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": name, "description": description, "registration_mode": "ai"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 201, r.text
    return r.json()["system"]["id"]


async def _open_and_settle(client: httpx.AsyncClient, system_id: str) -> None:
    """POST /open (freezes the dossier + schedules the background pipeline), then
    GET /state so the ASGI background task has run before we read the DB."""
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/open", headers=_hdr(_OWNER)
    )
    assert r.status_code == 200, r.text
    r2 = await client.get(
        f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
    )
    assert r2.status_code == 200, r2.text


def _fetch_dossier(system_id: str) -> dict:
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, inputs, config_snapshot, prompt_snapshot "
            "FROM assessment_dossiers WHERE ai_system_id = %s",
            (system_id,),
        )
        rows = cur.fetchall()
        assert len(rows) == 1, f"expected exactly one dossier, got {len(rows)}"
        did, inputs, config_snapshot, prompt_snapshot = rows[0]
        return {
            "id": did,
            "inputs": inputs,
            "config_snapshot": config_snapshot,
            "prompt_snapshot": prompt_snapshot,
        }
    finally:
        conn.close()


def _fetch_ai_output(system_id: str) -> dict | None:
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT o.payload FROM assessment_dossier_outputs o "
            "JOIN assessment_dossiers d ON d.id = o.dossier_id "
            "WHERE d.ai_system_id = %s AND o.layer = 'ai'",
            (system_id,),
        )
        rows = cur.fetchall()
        if not rows:
            return None
        assert len(rows) == 1, "ai layer must be write-once"
        return rows[0][0]
    finally:
        conn.close()


@pytest.fixture(autouse=True)
def _stub_pipeline_minio():
    """Patch the pipeline's MinIO upload (same as test_assessment.py) so /open's
    background pipeline runs without a live MinIO."""
    with ExitStack() as stack:
        stack.enter_context(
            patch(
                "app.questionnaire_pipeline.minio_client.ensure_bucket",
                new_callable=AsyncMock,
            )
        )
        stack.enter_context(
            patch(
                "app.questionnaire_pipeline.asyncio.to_thread",
                new_callable=AsyncMock,
                return_value=None,
            )
        )
        stack.enter_context(
            patch(
                "app.questionnaire_pipeline.minio_client.get_presigned_url",
                new_callable=AsyncMock,
                return_value="http://minio:9000/stub.json?sig=stub",
            )
        )
        yield


# ── (A) freeze inputs/config/prompts at assessment start ──────────────────────


@pytest.mark.asyncio
async def test_open_creates_dossier_with_frozen_inputs(client: httpx.AsyncClient):
    """The first /open of a fresh cycle creates exactly one dossier whose inputs,
    config, and prompts are frozen verbatim + hashed."""
    system_id = await _create_system(client, "Dossier System", "a test description")
    await _open_and_settle(client, system_id)

    d = _fetch_dossier(system_id)

    # Inputs: system name/description + (here empty) document list.
    assert d["inputs"]["system"]["id"] == system_id
    assert d["inputs"]["system"]["name"] == "Dossier System"
    assert d["inputs"]["system"]["description"] == "a test description"
    assert d["inputs"]["documents"] == []

    # Config snapshot: questionnaire captured verbatim + sha256.
    q = d["config_snapshot"]["questionnaire"]
    assert q["id"] == "ai-questionnaire"
    assert q["content"]
    assert len(q["sha256"]) == 64

    # Prompt snapshot: both prompts captured verbatim + sha256.
    prefill = d["prompt_snapshot"]["prefill"]
    classify = d["prompt_snapshot"]["classification"]
    assert prefill["id"] == "questionnaire_answer"
    assert prefill["content"]
    assert len(prefill["sha256"]) == 64
    assert classify["id"] == "classify_questionnaire"
    assert classify["content"]
    assert len(classify["sha256"]) == 64


@pytest.mark.asyncio
async def test_reopen_does_not_create_a_second_dossier(client: httpx.AsyncClient):
    """/open is idempotent per cycle — re-opening does not create another dossier."""
    system_id = await _create_system(client, "Idempotent System", "desc")
    await _open_and_settle(client, system_id)
    await _open_and_settle(client, system_id)
    # _fetch_dossier asserts exactly one row.
    _fetch_dossier(system_id)


# ── (B) append the AI output layer after the pipeline completes ───────────────


@pytest.mark.asyncio
async def test_pipeline_writes_ai_output_layer(client: httpx.AsyncClient):
    """After the background pipeline settles, the dossier has a single 'ai' output
    layer carrying the per-question answers and the proposed classification."""
    system_id = await _create_system(client, "Output System", "desc")
    await _open_and_settle(client, system_id)

    payload = _fetch_ai_output(system_id)
    assert payload is not None, "pipeline should have appended the ai output layer"
    assert isinstance(payload["answers"], list)
    # The stub classifier derives a tier from the stub answers.
    assert payload["classification"]["tier"] is not None


# ── immutability: append-only is DB-enforced ──────────────────────────────────


@pytest.mark.asyncio
async def test_dossier_is_append_only(client: httpx.AsyncClient):
    """The BEFORE UPDATE/DELETE trigger makes a captured dossier un-mutable and
    un-deletable — changing a value is technically impossible, not just detectable."""
    system_id = await _create_system(client, "Immutable System", "desc")
    await _open_and_settle(client, system_id)
    dossier_id = _fetch_dossier(system_id)["id"]

    conn = _pg()
    conn.autocommit = True  # each statement is its own txn; errors don't wedge it
    try:
        cur = conn.cursor()

        # UPDATE a frozen column → blocked.
        with pytest.raises(psycopg2.Error) as ei_update:
            cur.execute(
                "UPDATE assessment_dossiers SET config_snapshot = '{}'::jsonb "
                "WHERE id = %s",
                (dossier_id,),
            )
        assert "append-only" in str(ei_update.value).lower()

        # DELETE the dossier row → blocked.
        with pytest.raises(psycopg2.Error) as ei_delete:
            cur.execute("DELETE FROM assessment_dossiers WHERE id = %s", (dossier_id,))
        assert "append-only" in str(ei_delete.value).lower()

        # DELETE an output layer → blocked too.
        with pytest.raises(psycopg2.Error) as ei_out:
            cur.execute(
                "DELETE FROM assessment_dossier_outputs WHERE dossier_id = %s",
                (dossier_id,),
            )
        assert "append-only" in str(ei_out.value).lower()
    finally:
        conn.close()
