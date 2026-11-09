"""Compliance Advisor — a grounded EU AI Act chatbot agent (PydanticAI).

A single PydanticAI ``Agent`` answers compliance questions during the assessment
workflow, grounded in two tools:

- ``search_system_documents`` → document-indexing ``/v1/retrieve`` (RAG over the
  system's own uploaded docs; returns passages with filename + page).
- ``search_eu_ai_act`` → cognee-eval ``/v1/evaluate`` (grounded knowledge-graph
  Q&A over the EU AI Act; a single shared, tenant-agnostic graph).

LLM backend is Thalamus, reusing the configuration already resolved in
``app.llm.client`` (base URL / token / model + stub detection — single source).
In stub mode (``THALAMUS_BASE_URL`` unset or ``"stub"``, the CI/dev default) the
agent runs against PydanticAI's ``TestModel`` so the full tool-calling loop works
offline with no network.

Guardrails: every run is bounded by ``UsageLimits`` (request + token + tool-call
caps) and an outer wall-clock timeout, so the agent can never loop indefinitely.
A tripped guardrail raises ``AdvisorGuardrailError`` which the router maps to a
user-safe 502.

The system prompt wording is externalized to
``context/prompts/compliance_advisor.md`` (loaded via ``app.llm.templates``);
edit that file to change wording — no code change.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Literal

import httpx
from ai_trust_logging import get_logger
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext, UsageLimits
from pydantic_ai.exceptions import (
    ModelAPIError,
    ModelRateLimitError,
    UsageLimitExceeded,
)

from app.llm import client as llm_client
from app.llm.templates import load_template

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_INDEXING_URL = os.environ.get(
    "INDEXING_BACKEND_URL", "http://document-indexing-backend:8011"
).rstrip("/")
_COGNEE_URL = os.environ.get(
    "COGNEE_BACKEND_URL", "http://cognee-eval-backend:8014"
).rstrip("/")

# Guardrails — bound the agentic loop so the agent can never run away. The
# request/tool-call caps stop infinite tool↔model loops; the token cap is a
# budget ceiling. The token default is generous because a *single* grounded turn
# legitimately carries large context (system-document RAG passages + the EU AI
# Act answer + the system prompt) — a real Thalamus turn was measured at ~37k
# tokens, so 20k wrongly tripped on the happy path. The request/tool caps are
# the real loop guard but kept comfortably above a normal turn (two tools, each
# possibly refined once, plus synthesis) so legitimate multi-step answers aren't
# cut off; tokens get headroom.
_REQUEST_LIMIT = int(os.environ.get("ADVISOR_REQUEST_LIMIT", "10"))
_TOKEN_LIMIT = int(os.environ.get("ADVISOR_TOKEN_LIMIT", "120000"))
_TOOL_CALLS_LIMIT = int(os.environ.get("ADVISOR_TOOL_CALLS_LIMIT", "10"))
_TIMEOUT_SECONDS = float(os.environ.get("ADVISOR_TIMEOUT_SECONDS", "45"))

_RAG_K = 6
_HTTP_TIMEOUT = 20.0


def _tracing_on() -> bool:
    """Advisor Langfuse tracing: opt-in flag (default OFF).

    ``ADVISOR_TRACING`` defaults to ``false`` — set it to ``true``/``1``/``yes``
    to enable. Even when on, tracing only emits when Langfuse credentials are
    configured (``langfuse_client.is_enabled()``); so enabling the flag without
    ``LANGFUSE_*`` set is still a silent no-op.
    """
    flag = os.environ.get("ADVISOR_TRACING", "false").strip().lower()
    return flag in ("true", "1", "yes", "on")


class AdvisorGuardrailError(Exception):
    """A guardrail tripped (usage limit or timeout). Router maps to 502."""


class AdvisorUpstreamError(Exception):
    """The LLM backend (Thalamus) was unavailable or rate-limited.

    Distinct from ``AdvisorGuardrailError`` (our own usage/timeout caps): this
    is an *upstream* fault surfaced by PydanticAI (``ModelAPIError`` and
    subclasses). Kept framework-agnostic — the router owns the HTTP mapping,
    mirroring ``AdvisorGuardrailError``. ``retryable`` is ``True`` for a rate
    limit (client should back off → 429) and ``False`` for a connection/HTTP
    fault (upstream is down → 502), so a caller can tell "LLM is briefly
    throttled" from "LLM is down" from "our code is broken" (a real 500).
    """

    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


# ---------------------------------------------------------------------------
# Structured output + dependencies
# ---------------------------------------------------------------------------


class AdvisorSource(BaseModel):
    """One grounding citation. Either a system document or an EU AI Act reference.

    ``document_id`` / ``version_id`` are **not** produced by the LLM (it would
    hallucinate them) — they are resolved server-side after the run by matching
    the cited filename + page back to the passages the RAG tool actually
    returned, so a document chip can deep-link to the real original.
    """

    kind: Literal["document", "act"]
    ref: str = Field(
        description="Document filename, or EU AI Act article/annex reference."
    )
    detail: str | None = Field(
        default=None, description="Short supporting snippet or context."
    )
    page: int | None = Field(
        default=None, description="Page number for a document source."
    )
    # Resolved server-side (never by the model) for document deep-linking.
    document_id: str | None = Field(default=None)
    version_id: str | None = Field(default=None)


class AdvisorAnswer(BaseModel):
    """The agent's grounded answer. ``sources`` is empty only when nothing was found."""

    answer: str
    sources: list[AdvisorSource] = Field(default_factory=list)


@dataclass
class AdvisorDeps:
    """Per-request identity/scoping passed to tools.

    ``access_token`` is the forwarded OIDC token (``X-Forwarded-Access-Token`` /
    ``Authorization: Bearer``); forwarding it downstream lets the tenant
    middleware resolve the tenant in ``TENANCY_MODE=jwt`` for the system-document
    RAG call. The EU AI Act graph is global, so the act tool needs no tenant.
    """

    system_id: str
    username: str
    access_token: str | None = None
    correlation_id: str | None = None
    # Populated by the RAG tool with the source refs it actually returned, used
    # after the run to resolve document_id/version_id for each cited document
    # and to drop document citations that match no retrieved passage.
    retrieved: list[dict] = field(default_factory=list)
    # Set True by the Act tool when cognee returned real (non-gap) evidence this
    # run; when False, act citations are dropped (the model cited the Act with no
    # grounding). Cognee's output has no per-reference anchor, so this is a
    # run-level grounding flag, not per-citation validation.
    act_grounded: bool = False


# ---------------------------------------------------------------------------
# Agent construction
# ---------------------------------------------------------------------------


def _build_model():
    """Build the Thalamus model, or ``None`` in stub mode (caller uses TestModel)."""
    if llm_client._STUB_MODE:
        return None
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    provider = OpenAIProvider(
        base_url=llm_client.THALAMUS_BASE_URL,
        api_key=llm_client.THALAMUS_BEARER_TOKEN or "none",
    )
    return OpenAIChatModel(llm_client.THALAMUS_MODEL, provider=provider)


_tracing_ready = False


def _setup_tracing_once() -> None:
    """Enable Langfuse/OTel tracing for the agent, once, best-effort.

    Initialising the Langfuse client registers a global OpenTelemetry
    ``TracerProvider``; ``Agent.instrument_all()`` then makes every PydanticAI
    model request + tool call emit OTel spans into it, so a full trace of each
    advisor turn (prompt → tool calls → model output + token usage) shows up
    in Langfuse. No-op (and never raises) when the opt-out flag is set or no
    Langfuse credentials are configured.
    """
    global _tracing_ready
    if _tracing_ready:
        return
    _tracing_ready = True  # set first: a failure must not retry on every build
    if not _tracing_on():
        return
    try:
        from app import langfuse_client

        if not langfuse_client.is_enabled():
            return
        if langfuse_client.get_langfuse() is None:  # registers the tracer provider
            return
        from pydantic_ai import Agent

        Agent.instrument_all()
        logger.info("advisor.tracing_enabled")
    except Exception as exc:  # pragma: no cover - tracing is best-effort
        logger.warning("advisor.tracing_setup_failed", extra={"error": str(exc)})


def _build_agent():
    """Construct the advisor Agent. Model is Thalamus (live) or TestModel (stub)."""
    _setup_tracing_once()
    model = _build_model()
    if model is None:
        from pydantic_ai.models.test import TestModel

        # Deterministic offline model: calls both tools, then emits a fixed
        # grounded answer so e2e tests exercise the whole loop without network.
        model = TestModel(
            custom_output_args={
                "answer": (
                    "Based on the system's documentation and the EU AI Act, this is a "
                    "stub advisor answer for offline/CI mode."
                ),
                "sources": [
                    {
                        "kind": "document",
                        "ref": "stub-document.pdf",
                        "detail": "stub passage",
                        "page": 1,
                    },
                    {
                        "kind": "act",
                        "ref": "Article 6 (high-risk classification)",
                        "detail": "stub act reference",
                        "page": None,
                    },
                ],
            }
        )

    agent = Agent(
        model,
        deps_type=AdvisorDeps,
        output_type=AdvisorAnswer,
        instructions=load_template("compliance_advisor"),
        retries=1,
    )

    @agent.tool
    async def search_system_documents(ctx: RunContext[AdvisorDeps], query: str) -> str:
        """Search the uploaded documentation for THIS AI system.

        Use for anything about what the system does, who it affects, how it is
        deployed, or what its own documents state. Returns ranked passages with
        their source filename and page for citation.
        """
        return await _search_system_documents(ctx.deps, query)

    @agent.tool
    async def search_eu_ai_act(ctx: RunContext[AdvisorDeps], query: str) -> str:
        """Search the EU AI Act knowledge base (articles, annexes, obligations).

        Use for anything about what the law says or requires. Returns a grounded
        answer plus the supporting references.
        """
        return await _search_eu_ai_act(ctx.deps, query)

    return agent


# Lazily-built singleton — avoids importing pydantic_ai at module import (keeps
# app startup / stub import light) and reuses one agent across requests.
_agent = None


def _get_agent():
    global _agent
    if _agent is None:
        _agent = _build_agent()
    return _agent


# ---------------------------------------------------------------------------
# Tool implementations (plain async fns — unit-testable, mockable)
# ---------------------------------------------------------------------------


def _downstream_headers(deps: AdvisorDeps) -> dict[str, str]:
    headers = {"x-forwarded-preferred-username": deps.username}
    if deps.correlation_id:
        headers["x-correlation-id"] = deps.correlation_id
    # Forward the OIDC token so the downstream tenant middleware resolves the
    # tenant in jwt mode. Harmless (ignored) in single-tenant mode.
    if deps.access_token:
        headers["x-forwarded-access-token"] = deps.access_token
    return headers


async def _search_system_documents(deps: AdvisorDeps, query: str) -> str:
    """POST document-indexing /v1/retrieve. Best-effort: never raises to the agent."""
    payload = {
        "ai_system_id": deps.system_id,
        "query": query,
        "k": _RAG_K,
        "mode": "hybrid",
    }
    url = f"{_INDEXING_URL}/v1/retrieve"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as http:
            resp = await http.post(url, json=payload, headers=_downstream_headers(deps))
        if resp.status_code >= 400:
            logger.warning(
                "advisor.rag_unavailable",
                extra={"system_id": deps.system_id, "status": resp.status_code},
            )
            return "No system documents were available for this query."
        data = resp.json()
        results = data.get("results", data) if isinstance(data, dict) else data
    except Exception as exc:
        logger.warning(
            "advisor.rag_failed",
            extra={"system_id": deps.system_id, "error": str(exc)},
        )
        return "No system documents were available for this query."

    if not results:
        return "No relevant passages were found in this system's documents."

    lines = ["System document passages (cite by filename + page):"]
    for i, chunk in enumerate(results, 1):
        source = chunk.get("source") or {}
        filename = source.get("filename", f"Document {i}")
        page = source.get("page")
        passage = chunk.get("passage", "")
        page_str = f", page {page}" if page is not None else ""
        lines.append(f"\n[{i}] {filename}{page_str}\n{passage}")
        # Capture the real source ref so the citation can be resolved to a
        # deep-link after the run (the model only ever sees filename + page).
        if filename and source.get("document_id"):
            deps.retrieved.append(
                {
                    "filename": filename,
                    "page": page,
                    "document_id": source.get("document_id"),
                    "version_id": source.get("version_id"),
                }
            )
    return "\n".join(lines)


async def _search_eu_ai_act(deps: AdvisorDeps, query: str) -> str:
    """POST cognee-eval /v1/evaluate. Best-effort: never raises to the agent."""
    url = f"{_COGNEE_URL}/v1/evaluate"
    headers = {"x-forwarded-preferred-username": deps.username}
    if deps.correlation_id:
        headers["x-correlation-id"] = deps.correlation_id
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as http:
            resp = await http.post(url, json={"question": query}, headers=headers)
        if resp.status_code >= 400:
            logger.warning(
                "advisor.act_unavailable",
                extra={"status": resp.status_code},
            )
            return "The EU AI Act knowledge base was unavailable for this query."
        data = resp.json()
    except Exception as exc:
        logger.warning("advisor.act_failed", extra={"error": str(exc)})
        return "The EU AI Act knowledge base was unavailable for this query."

    answer = data.get("answer")
    evidence = data.get("source_evidence") or []
    if data.get("knowledge_gap") or not answer:
        return "No relevant EU AI Act provision was found for this query."

    # Cognee returned a real, non-gap answer — act citations are grounded this run.
    deps.act_grounded = True
    lines = ["EU AI Act grounded answer (cite as act references):", str(answer)]
    if evidence:
        lines.append("\nSupporting references:")
        for i, item in enumerate(evidence, 1):
            text = item.get("text", "")
            lines.append(f"[{i}] {text}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def ask_advisor(
    *,
    message: str,
    deps: AdvisorDeps,
    transcript: list[dict] | None = None,
) -> AdvisorAnswer:
    """Run one advisor turn. Returns the grounded answer.

    A guardrail that produces no answer raises ``AdvisorGuardrailError`` (router
    → 502); an upstream LLM fault raises ``AdvisorUpstreamError`` (router → 429
    rate-limited / 502 unavailable). There is no partial-answer path — a tripped
    guardrail always raises rather than returning a trimmed answer.

    ``transcript`` is the prior conversation (``[{role, content}, …]``); it is
    prepended to the current message as context (stateless — the frontend holds
    and resends it each turn).
    """
    agent = _get_agent()

    prompt = _compose_prompt(message, transcript)
    usage_limits = UsageLimits(
        request_limit=_REQUEST_LIMIT,
        total_tokens_limit=_TOKEN_LIMIT,
        tool_calls_limit=_TOOL_CALLS_LIMIT,
    )

    async def _run() -> AdvisorAnswer:
        try:
            result = await asyncio.wait_for(
                agent.run(prompt, deps=deps, usage_limits=usage_limits),
                timeout=_TIMEOUT_SECONDS,
            )
        except (UsageLimitExceeded, asyncio.TimeoutError) as exc:
            logger.warning(
                "advisor.guardrail_tripped",
                extra={"system_id": deps.system_id, "error": str(exc)},
            )
            raise AdvisorGuardrailError(str(exc)) from exc
        except ModelRateLimitError as exc:
            logger.warning(
                "advisor.upstream_rate_limited",
                extra={"system_id": deps.system_id, "error": str(exc)},
            )
            raise AdvisorUpstreamError(str(exc), retryable=True) from exc
        except ModelAPIError as exc:
            # HTTP / connection / timeout / overloaded — any upstream fault.
            # ModelAPIError is the base of ModelHTTPError, ModelConnectionError,
            # ModelTimeoutError, etc. in pydantic-ai, so a new subclass can't
            # silently fall through to a raw 500.
            logger.error(
                "advisor.upstream_unavailable",
                extra={"system_id": deps.system_id, "error": str(exc)},
            )
            raise AdvisorUpstreamError(str(exc), retryable=False) from exc

        usage = result.usage
        logger.info(
            "advisor.answered",
            extra={
                "system_id": deps.system_id,
                "requests": getattr(usage, "requests", 0),
                "input_tokens": getattr(usage, "input_tokens", 0),
                "output_tokens": getattr(usage, "output_tokens", 0),
                "sources": len(result.output.sources),
            },
        )
        return result.output

    output = await _run_traced(_run, message=message, deps=deps)
    _filter_and_resolve_sources(output, deps)
    return output


def _filter_and_resolve_sources(answer: AdvisorAnswer, deps: AdvisorDeps) -> None:
    """Resolve deep-links and drop ungrounded citations, in place.

    Grounding is enforced server-side so the UI never presents a model-invented
    reference as a real source:

    - **document** — matched to a ref the RAG tool actually returned (by
      ``filename`` + ``page``, falling back to ``filename``); matched sources get
      ``document_id``/``version_id`` for the deep-link, and **unmatched document
      sources are dropped** (the model cited a doc that was never retrieved).
    - **act** — kept only when the Act tool got real evidence from cognee this
      run (``deps.act_grounded``). Cognee returns no per-reference anchor, so this
      is a run-level grounding check, not per-citation validation; when the Act
      tool returned nothing/knowledge-gap, all act citations are dropped.
    """
    retrieved = deps.retrieved
    kept: list[AdvisorSource] = []
    for src in answer.sources:
        if src.kind == "act":
            if deps.act_grounded:
                kept.append(src)
            continue
        # document: find the real retrieved ref it refers to.
        match = next(
            (
                r
                for r in retrieved
                if r["filename"] == src.ref and r["page"] == src.page
            ),
            None,
        ) or next((r for r in retrieved if r["filename"] == src.ref), None)
        if not match:
            continue  # drop: no retrieved passage backs this document citation
        src.document_id = match.get("document_id")
        src.version_id = match.get("version_id")
        if src.page is None:
            src.page = match.get("page")
        kept.append(src)
    answer.sources = kept


async def _run_traced(run, *, message: str, deps: AdvisorDeps) -> AdvisorAnswer:
    """Run ``run()`` inside a Langfuse observation when tracing is active.

    The observation is the trace root for this turn (named ``advisor.ask``,
    tagged with the system + user); PydanticAI's own instrumentation nests the
    model requests and tool calls underneath it. Best-effort: any tracing error
    is swallowed and the agent still runs. A no-op passthrough when tracing is
    off or Langfuse is not configured.
    """
    if not _tracing_on():
        return await run()
    try:
        from app import langfuse_client

        lf = langfuse_client.get_langfuse() if langfuse_client.is_enabled() else None
    except Exception:  # pragma: no cover - defensive
        lf = None
    if lf is None:
        return await run()

    with lf.start_as_current_observation(
        name="advisor.ask",
        as_type="agent",
        input={"message": message},
        metadata={"system_id": deps.system_id, "username": deps.username},
    ):
        output = await run()
        try:
            lf.update_current_span(
                output={
                    "answer": output.answer,
                    "sources": [s.model_dump() for s in output.sources],
                }
            )
        except Exception:  # pragma: no cover - tracing is best-effort
            pass
        return output


def _compose_prompt(message: str, transcript: list[dict] | None) -> str:
    """Prepend prior turns as plain context, then the current question."""
    if not transcript:
        return message
    lines = ["Conversation so far:"]
    for turn in transcript:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        speaker = "Assistant" if role == "assistant" else "User"
        lines.append(f"{speaker}: {content}")
    lines.append(f"\nCurrent question:\n{message}")
    return "\n".join(lines)
