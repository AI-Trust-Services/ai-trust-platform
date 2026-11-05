"""E2E tests for the Compliance Advisor chatbot endpoint.

POST /v1/systems/{id}/advisor/ask — a stateless, grounded chat turn.

Runs in stub LLM mode (THALAMUS_BASE_URL unset → the agent uses PydanticAI's
TestModel), so the full tool-calling loop runs offline: both tools are invoked
and a deterministic grounded answer with sources is returned. The downstream
HTTP tools (document-indexing, cognee-eval) are not reachable in CI; they fail
best-effort and return "unavailable" strings to the agent, which is fine — the
stub model's output is fixed regardless of tool content.
"""

from __future__ import annotations

import httpx
import pytest

_OWNER = "owner1"


def _hdr(user: str = _OWNER) -> dict:
    return {"x-forwarded-preferred-username": user}


async def _create_system(client: httpx.AsyncClient, owner: str = _OWNER) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Advisor System", "registration_mode": "ai"},
        headers=_hdr(owner),
    )
    assert r.status_code == 201, r.text
    return r.json()["system"]["id"]


@pytest.mark.asyncio
async def test_ask_returns_grounded_answer(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{system_id}/advisor/ask",
        json={"message": "Is this system high-risk under the EU AI Act?"},
        headers=_hdr(),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"]  # non-empty
    assert body["degraded"] is False
    # The stub model emits one document + one act source.
    kinds = {s["kind"] for s in body["sources"]}
    assert kinds == {"document", "act"}
    doc = next(s for s in body["sources"] if s["kind"] == "document")
    assert doc["ref"] and doc["page"] == 1


@pytest.mark.asyncio
async def test_ask_accepts_transcript(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{system_id}/advisor/ask",
        json={
            "message": "What should I document for it?",
            "transcript": [
                {"role": "user", "content": "Is it high-risk?"},
                {"role": "assistant", "content": "It may be, under Annex III."},
            ],
        },
        headers=_hdr(),
    )
    assert r.status_code == 200, r.text
    assert r.json()["answer"]


@pytest.mark.asyncio
async def test_ask_unknown_system_404(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/systems/SYS-DOESNOT/advisor/ask",
        json={"message": "hello"},
        headers=_hdr(),
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_ask_empty_message_422(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{system_id}/advisor/ask",
        json={"message": ""},
        headers=_hdr(),
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_ask_guardrail_tripped_502(client: httpx.AsyncClient, monkeypatch):
    """A tripped guardrail (usage limit / timeout) maps to a user-safe 502."""
    system_id = await _create_system(client)

    from app.advisor.agent import AdvisorGuardrailError
    from app.routers import advisor as advisor_router

    async def _boom(*_a, **_kw):
        raise AdvisorGuardrailError("request_limit exceeded")

    monkeypatch.setattr(advisor_router, "ask_advisor", _boom)

    r = await client.post(
        f"/v1/systems/{system_id}/advisor/ask",
        json={"message": "loop forever"},
        headers=_hdr(),
    )
    assert r.status_code == 502, r.text
    assert "could not complete" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_tracing_wraps_run_when_langfuse_enabled(
    client: httpx.AsyncClient, monkeypatch
):
    """With tracing on + Langfuse configured, the turn is wrapped in a Langfuse
    observation and still returns a grounded answer. Verifies the tracing path
    (_run_traced's Langfuse branch) without a real Langfuse server."""
    import contextlib

    from app.advisor import agent as agent_mod
    from app import langfuse_client

    opened: list[dict] = []
    outputs: list[dict] = []

    class _FakeLF:
        @contextlib.contextmanager
        def start_as_current_observation(self, **kwargs):
            opened.append(kwargs)
            yield

        def update_current_span(self, **kwargs):
            outputs.append(kwargs)

    # Force the tracing-on + Langfuse-enabled branch deterministically.
    monkeypatch.setenv("ADVISOR_TRACING", "true")
    monkeypatch.setattr(langfuse_client, "is_enabled", lambda: True)
    monkeypatch.setattr(langfuse_client, "get_langfuse", lambda: _FakeLF())
    # instrument_all touches the global OTel provider; make it a no-op here.
    from pydantic_ai import Agent

    monkeypatch.setattr(Agent, "instrument_all", staticmethod(lambda *a, **k: None))
    # Reset the agent + tracing singletons so the patched branch is taken.
    monkeypatch.setattr(agent_mod, "_agent", None)
    monkeypatch.setattr(agent_mod, "_tracing_ready", False)

    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{system_id}/advisor/ask",
        json={"message": "Is this system high-risk?"},
        headers=_hdr(),
    )
    assert r.status_code == 200, r.text
    assert r.json()["answer"]
    # The observation was opened as the trace root, tagged with the system id,
    # and the answer was attached as its output.
    assert opened and opened[0]["name"] == "advisor.ask"
    assert opened[0]["metadata"]["system_id"] == system_id
    assert outputs and "answer" in outputs[0]["output"]


@pytest.mark.asyncio
async def test_tool_spans_distinguish_cognee_and_rag():
    """The agentic flow emits a per-tool OTel span, so a trace shows whether the
    EU AI Act (cognee) tool and/or the system-document (RAG) tool were used."""
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )
    from pydantic_ai import Agent

    from app.advisor.agent import ask_advisor, AdvisorDeps

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    Agent.instrument_all()  # enable PydanticAI OTel instrumentation

    await ask_advisor(
        message="is this high risk?",
        deps=AdvisorDeps(system_id="SYS-1", username="u"),
    )
    provider.force_flush()

    tool_names = {
        s.attributes.get("gen_ai.tool.name")
        for s in exporter.get_finished_spans()
        if s.attributes.get("gen_ai.tool.name")
    }
    # The stub TestModel calls every tool; both grounding tools must be traceable.
    assert "search_eu_ai_act" in tool_names  # cognee
    assert "search_system_documents" in tool_names  # RAG


def test_resolve_document_links_matches_retrieved_refs():
    """A cited document source is enriched with document_id/version_id from the
    refs the RAG tool actually returned (never invented by the model); an Act
    source and an unmatched filename stay unlinked."""
    from app.advisor.agent import (
        AdvisorAnswer,
        AdvisorSource,
        _resolve_document_links,
    )

    answer = AdvisorAnswer(
        answer="x",
        sources=[
            AdvisorSource(kind="document", ref="spec.pdf", page=3),
            AdvisorSource(kind="document", ref="ghost.pdf", page=1),
            AdvisorSource(kind="act", ref="Article 6"),
        ],
    )
    retrieved = [
        {
            "filename": "spec.pdf",
            "page": 3,
            "document_id": "DOC-1",
            "version_id": "DOCV-1",
        },
    ]
    _resolve_document_links(answer, retrieved)

    assert answer.sources[0].document_id == "DOC-1"  # matched
    assert answer.sources[0].version_id == "DOCV-1"
    assert answer.sources[1].document_id is None  # no retrieved match → unlinked
    assert answer.sources[2].document_id is None  # act never links
