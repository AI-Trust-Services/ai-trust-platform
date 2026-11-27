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


def _fetch_output(system_id: str, layer: str) -> dict | None:
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT o.payload FROM assessment_dossier_outputs o "
            "JOIN assessment_dossiers d ON d.id = o.dossier_id "
            "WHERE d.ai_system_id = %s AND o.layer = %s",
            (system_id, layer),
        )
        rows = cur.fetchall()
        if not rows:
            return None
        assert len(rows) == 1, f"{layer!r} layer must be write-once"
        return rows[0][0]
    finally:
        conn.close()


def _fetch_ai_output(system_id: str) -> dict | None:
    return _fetch_output(system_id, "ai")


@pytest.fixture(autouse=True)
def _stub_pipeline_minio():
    """In-memory stand-in for MinIO, active for every test in this module.

    The questionnaire pipeline saves its result, the classification pipeline
    reads it back and saves its own, and the solver reads that — /open runs the
    whole chain. A write-only stub would leave the read-backs empty, so this
    patches the ``minio_client`` JSON helpers with a round-trip dict store
    (mirrors ``minio_store`` in test_assessment.py)."""
    store: dict[str, object] = {}

    async def _put(key: str, obj: object) -> None:
        store[key] = obj

    async def _get(key: str) -> object:
        if key not in store:
            raise KeyError(f"Object '{key}' not found")
        return store[key]

    with ExitStack() as stack:
        stack.enter_context(
            patch("app.minio_client.put_json", new=AsyncMock(side_effect=_put))
        )
        stack.enter_context(
            patch("app.minio_client.get_json", new=AsyncMock(side_effect=_get))
        )
        stack.enter_context(
            patch(
                "app.minio_client.get_presigned_url",
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
    # Full relational evidence is frozen — the whole field set the pipeline feeds
    # the LLM, not just name/description (#366 relational-data versioning).
    for k in ("org_role", "intended_purpose", "system_type", "tier", "lifecycle"):
        assert k in d["inputs"]["system"], f"evidence field {k!r} missing from snapshot"
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

    # Classification config: pinned by sha256 reference (no separate config file —
    # the classifier is deterministic Python, pinned by source hash per #366).
    c = d["config_snapshot"]["classification"]
    assert c["id"] == "classifier"
    assert c["source"].endswith("classifier.py")
    assert len(c["sha256"]) == 64


def _insert_document(system_id: str, filename: str, status: str) -> tuple[str, str]:
    """Seed a document + a current version at the given indexing status, so the
    snapshot query (current + indexed) can pick it up. Returns (doc_id, version_id).

    IDs are generated per call (``new_id``) — ``documents`` has no FK to
    ``ai_systems`` and the registry conftest does not truncate it, so hardcoded
    IDs would collide across re-runs. The snapshot filters by ``ai_system_id``
    (unique per run), so leftover rows from other systems never leak in."""
    from app.ids import new_id

    doc_id = new_id("DOC")
    version_id = new_id("DOCV")
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO documents (id, ai_system_id, filename) VALUES (%s, %s, %s)",
            (doc_id, system_id, filename),
        )
        cur.execute(
            "INSERT INTO document_versions "
            "(id, document_id, version_label, minio_key, file_name, file_size, "
            " status, is_current, indexed_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, now())",
            (
                version_id,
                doc_id,
                "1.0",
                f"{doc_id}/{version_id}/{filename}",
                filename,
                123,
                status,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return doc_id, version_id


@pytest.mark.asyncio
async def test_snapshot_pins_current_indexed_document_versions(
    client: httpx.AsyncClient,
):
    """The snapshot captures each document's current + indexed version (pinned by
    version_id); a version still processing at open is excluded (it did not feed
    the run)."""
    system_id = await _create_system(client, "Docs System", "desc")
    indexed_doc, indexed_ver = _insert_document(system_id, "indexed.pdf", "indexed")
    _insert_document(system_id, "pending.pdf", "pending")

    await _open_and_settle(client, system_id)

    docs = _fetch_dossier(system_id)["inputs"]["documents"]
    assert len(docs) == 1, "only the current + indexed version is captured"
    d0 = docs[0]
    assert d0["document_id"] == indexed_doc
    assert d0["version_id"] == indexed_ver
    assert d0["version_label"] == "1.0"
    assert d0["filename"] == "indexed.pdf"
    assert d0["indexed_at"] is not None


@pytest.mark.asyncio
async def test_reopen_does_not_create_a_second_dossier(client: httpx.AsyncClient):
    """/open is idempotent per cycle — re-opening does not create another dossier."""
    system_id = await _create_system(client, "Idempotent System", "desc")
    await _open_and_settle(client, system_id)
    await _open_and_settle(client, system_id)
    # _fetch_dossier asserts exactly one row.
    _fetch_dossier(system_id)


@pytest.mark.asyncio
async def test_open_fails_when_dossier_fails(
    client: httpx.AsyncClient, monkeypatch
):
    """A failing dossier snapshot must abort /open (hard precondition).

    The dossier is now in the main transaction — if it fails the whole /open
    rolls back (no question_states written), and a retry /open can succeed once
    the underlying issue is gone.
    """
    import app.routers.assessment as asmt
    from sqlalchemy import text

    async def _boom(session, row, assessment_id):
        # Simulate a snapshot query error (poisons the transaction).
        await session.execute(text("SELECT 1 FROM table_that_does_not_exist"))

    monkeypatch.setattr(asmt, "create_dossier_in_session", _boom)

    system_id = await _create_system(client, "Resilient System", "desc")
    # ASGITransport re-raises server exceptions in the test process, so a 500
    # surfaces as an exception here rather than an HTTP response.
    with pytest.raises(Exception):
        await client.post(
            f"/v1/systems/{system_id}/assessment/open", headers=_hdr(_OWNER)
        )

    conn = _pg()
    try:
        cur = conn.cursor()
        # Neither the dossier nor question_states should have been written.
        cur.execute(
            "SELECT count(*) FROM assessment_dossiers WHERE ai_system_id = %s",
            (system_id,),
        )
        assert cur.fetchone()[0] == 0, "dossier must not be written on failure"
        cur.execute(
            "SELECT count(*) FROM question_states WHERE system_id = %s", (system_id,)
        )
        assert cur.fetchone()[0] == 0, "question_states must not be written on failure"
    finally:
        conn.close()

    # Once the patch is removed (simulating the issue being fixed) a retry succeeds.
    monkeypatch.undo()
    r2 = await client.post(
        f"/v1/systems/{system_id}/assessment/open", headers=_hdr(_OWNER)
    )
    assert r2.status_code == 200, r2.text


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
    # Self-describing: records the inputs this run actually consumed (#366) — the
    # relational evidence the LLM saw + the documents RAG surfaced (empty here:
    # the indexing backend is unreachable in e2e, so RAG returns nothing).
    consumed = payload["consumed_inputs"]
    assert isinstance(consumed["evidence"], dict) and consumed["evidence"]
    assert consumed["evidence"]["description"] == "desc"
    assert isinstance(consumed["documents"], list)


# ── immutability: contents frozen (UPDATE), but a dossier is deletable ─────────


@pytest.mark.asyncio
async def test_dossier_contents_immutable_but_deletable(client: httpx.AsyncClient):
    """A captured dossier's CONTENTS are frozen — a BEFORE UPDATE trigger rejects
    every UPDATE. DELETE is allowed (the trigger blocks UPDATE only), so the
    assessment lifecycle can remove a dossier when its assessment is
    deleted/aborted; the FK CASCADE then drops its output layers too."""
    system_id = await _create_system(client, "Immutable System", "desc")
    await _open_and_settle(client, system_id)
    dossier_id = _fetch_dossier(system_id)["id"]

    conn = _pg()
    conn.autocommit = True  # each statement is its own txn; errors don't wedge it
    try:
        cur = conn.cursor()

        # UPDATE a frozen column → blocked (contents can never change).
        with pytest.raises(psycopg2.Error) as ei_update:
            cur.execute(
                "UPDATE assessment_dossiers SET config_snapshot = '{}'::jsonb "
                "WHERE id = %s",
                (dossier_id,),
            )
        assert "append-only" in str(ei_update.value).lower()

        # DELETE the dossier → allowed now, and cascades to its output layers.
        cur.execute("DELETE FROM assessment_dossiers WHERE id = %s", (dossier_id,))
        cur.execute(
            "SELECT count(*) FROM assessment_dossier_outputs WHERE dossier_id = %s",
            (dossier_id,),
        )
        assert cur.fetchone()[0] == 0, "output layers should cascade-delete"
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_deleting_assessment_cascades_dossier(client: httpx.AsyncClient):
    """Deleting the parent assessment removes its dossier (FK CASCADE) — the exact
    operation that compliance /abort and /delete perform. Before migration 0051
    the RESTRICT FK blocked this with a ForeignKeyViolationError (→ 500)."""
    system_id = await _create_system(client, "Cascade System", "desc")
    await _open_and_settle(client, system_id)
    d = _fetch_dossier(system_id)

    conn = _pg()
    conn.autocommit = True
    try:
        cur = conn.cursor()
        # Delete the assessment the dossier hangs off (same as abort/delete).
        cur.execute(
            "DELETE FROM assessments WHERE id = "
            "(SELECT assessment_id FROM assessment_dossiers WHERE id = %s)",
            (d["id"],),
        )
        cur.execute(
            "SELECT count(*) FROM assessment_dossiers WHERE id = %s", (d["id"],)
        )
        assert cur.fetchone()[0] == 0, (
            "dossier should cascade-delete with its assessment"
        )
    finally:
        conn.close()


# ── (C) user_confirmed (#370) on /submit + co_issued (#370) on /issue ─────────

_CO = "officer1"


async def _confirm_all_and_submit(client: httpx.AsyncClient, system_id: str) -> None:
    """Owner-confirm every question of the current cycle, then submit to the CO
    (assigning the CO first, as the compliance 'New Assessment' modal does)."""
    r = await client.post(
        f"/v1/systems/{system_id}/workflow/assign",
        json={"compliance_officer_username": _CO},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    state = (
        await client.get(
            f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
        )
    ).json()
    for q in state["questions"]:
        r = await client.post(
            f"/v1/systems/{system_id}/assessment/questions/{q['question_key']}/confirm",
            headers=_hdr(_OWNER),
        )
        assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/submit",
        json={"note": "done"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_submit_writes_user_confirmed_layer(client: httpx.AsyncClient):
    """On /submit the dossier gains a 'user_confirmed' layer (per-question
    confirmed answers + classification as-shown) IN PARALLEL to 'ai' — the AI
    layer is untouched (#370's hard requirement: never overwrite the AI results)."""
    system_id = await _create_system(client, "Submit System", "desc")
    await _open_and_settle(client, system_id)
    ai_before = _fetch_ai_output(system_id)
    assert ai_before is not None

    await _confirm_all_and_submit(client, system_id)

    uc = _fetch_output(system_id, "user_confirmed")
    assert uc is not None, "/submit should append the user_confirmed layer"
    assert isinstance(uc["answers"], list) and uc["answers"], "per-question answers"
    assert all(a["confirmed_by"] == _OWNER for a in uc["answers"])
    # Classification as-shown (the stub pipeline derived a tier at /open).
    assert uc["classification"]["tier"] is not None

    # The AI layer is still there and unchanged — the two layers coexist.
    assert _fetch_ai_output(system_id) == ai_before


@pytest.mark.asyncio
async def test_issue_writes_co_issued_bundle(client: httpx.AsyncClient):
    """When the CO issues, the dossier gains a self-contained 'co_issued' bundle:
    frozen inputs + the ai + user_confirmed layers + the CO's binding decision."""
    system_id = await _create_system(client, "Issue System", "desc")
    await _open_and_settle(client, system_id)
    await _confirm_all_and_submit(client, system_id)

    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "high", "transparency": True, "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text

    bundle = _fetch_output(system_id, "co_issued")
    assert bundle is not None, "/issue should append the co_issued bundle"
    # Self-contained: inputs + both prior layers + the CO decision.
    assert bundle["inputs"]["system"]["id"] == system_id
    assert bundle["ai"] is not None
    assert bundle["user_confirmed"] is not None
    assert bundle["co_issued"]["tier"] == "high"
    assert bundle["co_issued"]["transparency"] is True
    assert bundle["co_issued"]["issued_by"] == _CO


@pytest.mark.asyncio
async def test_co_issued_bundle_reflects_resubmitted_answers(client: httpx.AsyncClient):
    """After a CO reject→resubmit, the co_issued bundle must carry the owner's
    FINAL answers, not the first submission. The user_confirmed layer is
    write-once (pinned to submit #1), so the bundle sources its confirmed answers
    from live question_states at confirm time instead of that frozen layer."""
    system_id = await _create_system(client, "Resubmit System", "desc")
    await _open_and_settle(client, system_id)
    await _confirm_all_and_submit(client, system_id)

    # CO bounces it back.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/reject",
        json={"note": "please revise"},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text

    # Owner changes one answer (a change from the AI pre-fill needs a comment
    # before it can be re-confirmed), then resubmits.
    state = (
        await client.get(
            f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
        )
    ).json()
    qkey = state["questions"][0]["question_key"]
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "RESUBMITTED_VALUE"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "revised per CO"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code in (200, 201), r.text
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/submit",
        json={"note": "resubmitted"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "high", "transparency": True, "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text

    # The user_confirmed LAYER is pinned to submit #1 (blank answer, write-once).
    uc = _fetch_output(system_id, "user_confirmed")
    uc_q0 = next(a for a in uc["answers"] if a["question_key"] == qkey)
    assert uc_q0["answer"] != "RESUBMITTED_VALUE"

    # The co_issued bundle carries the FINAL, resubmitted answer.
    bundle = _fetch_output(system_id, "co_issued")
    b_q0 = next(
        a for a in bundle["user_confirmed"]["answers"] if a["question_key"] == qkey
    )
    assert b_q0["answer"] == "RESUBMITTED_VALUE"
