"""Knowledge-grounded task agent.

Uses PydanticAI to orchestrate evidence retrieval and produce a structured,
validated TaskResult.

Architecture
------------
- ``AgentDeps`` carries all mutable run state: the httpx client, forwarded
  username, system/source config, retrieval knobs, and the ``retrieved`` dict
  that accumulates passages across tool calls.
- Three ``@agent.tool`` functions map source labels to configurable backends.
- An ``@agent.output_validator`` ensures (a) at least one retrieval happened,
  (b) every cited ref_id was actually retrieved.
- ``run_task()`` is the public async entry point for the router.

Env vars
--------
- ``AI_GATEWAY_URL`` — base URL for the AI gateway (default
  ``http://ai-gateway:8000``). The gateway serves a Claude-compatible
  ``/v1/messages`` endpoint.
- ``AGENT_MODEL`` — Anthropic model name (default ``claude``). The gateway
  routes this to whichever Claude model is configured there.
- ``COGNEE_EVAL_URL`` — base URL for the Cognee eval service (default
  ``http://cognee-eval-backend:8014``).
"""

from __future__ import annotations

import dataclasses
import os
from pathlib import Path

import httpx
from ai_trust_logging import get_logger
from anthropic import AsyncAnthropic
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider

from app.agent.citations import format_passage_block, register_passages
from app.agent.models import TaskResult
from app.agent.retrieval_backends import get_backend

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_AI_GATEWAY_URL = os.environ.get("AI_GATEWAY_URL", "http://ai-gateway:8000")
_AGENT_MODEL = os.environ.get("AGENT_MODEL", "claude")

# Source label → system_id mapping for the classic RAG backend.
_SYSTEM_ID_BY_SOURCE: dict[str, str] = {
    "legal": "__eu_ai_act__",
    "reviewed_judgments": "__reviewed_judgments__",
    # "system_evidence" uses the per-run system_id set in deps.
}


def _load_prompt(filename: str) -> str:
    """Load a prompt file from the prompts/ directory relative to this module."""
    return (_PROMPTS_DIR / filename).read_text(encoding="utf-8")


def _build_model() -> AnthropicModel:
    """Construct an AnthropicModel that targets the AI gateway."""
    provider = AnthropicProvider(
        anthropic_client=AsyncAnthropic(
            base_url=_AI_GATEWAY_URL,
            api_key="unused",
        )
    )
    return AnthropicModel(_AGENT_MODEL, provider=provider)


@dataclasses.dataclass
class AgentDeps:
    """All mutable state for a single agent run."""

    client: httpx.AsyncClient
    username: str
    system_id: str
    """The registered AI system's ID — used by the ``system_evidence`` tool."""
    source_backends: dict[str, str]
    """Maps source label → backend name (``classic`` | ``graph`` | ``hierarchical``)."""
    k: int = 5
    rrf_k: int = 60
    mode: str = "hybrid"
    retrieved: dict[str, dict] = dataclasses.field(default_factory=dict)
    """Accumulated retrieved passages keyed by ref_id."""


# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------

_system_prompt = _load_prompt("system.md")

agent: Agent[AgentDeps, TaskResult] = Agent(
    _build_model(),
    deps_type=AgentDeps,
    output_type=TaskResult,
    system_prompt=_system_prompt,
    retries=2,
)


@agent.tool
async def retrieve_legal_sources(
    ctx: RunContext[AgentDeps],
    question: str,
) -> str:
    """Retrieve passages from the EU AI Act corpus that are relevant to *question*.

    Use this tool to look up statutory text, Annex III risk categories, Article 5
    prohibitions, Article 6 criteria, Article 50 limited-risk disclosure rules, and
    any other EU AI Act provisions that bear on the task.

    Returns a numbered block of passages with their ref_ids.  Use the ref_ids in
    your ``source_references`` field.
    """
    source_label = "legal"
    system_id = _SYSTEM_ID_BY_SOURCE[source_label]
    backend_name = ctx.deps.source_backends.get(source_label, "classic")
    backend = get_backend(backend_name)

    passages = await backend.retrieve(
        source_label,
        question,
        system_id=system_id,
        client=ctx.deps.client,
        username=ctx.deps.username,
        k=ctx.deps.k,
        mode=ctx.deps.mode,
        rrf_k=ctx.deps.rrf_k,
    )

    enriched = register_passages(ctx.deps.retrieved, passages)
    block = format_passage_block(enriched)
    logger.info(
        "agent.tool.legal_sources",
        extra={"question": question[:120], "passages": len(enriched)},
    )
    return block or "(no passages retrieved)"


@agent.tool
async def retrieve_reviewed_judgments(
    ctx: RunContext[AgentDeps],
    question: str,
) -> str:
    """Retrieve expert-reviewed compliance judgments relevant to *question*.

    Use this tool to find past classification decisions, precedents, and
    interpretive guidance written by compliance experts and stored in the
    reviewed-judgments knowledge base.

    Returns a numbered block of passages with their ref_ids.  Use the ref_ids in
    ``applicable_judgments`` (and also in ``source_references`` if you quote them).
    """
    source_label = "reviewed_judgments"
    system_id = _SYSTEM_ID_BY_SOURCE[source_label]
    backend_name = ctx.deps.source_backends.get(source_label, "classic")
    backend = get_backend(backend_name)

    passages = await backend.retrieve(
        source_label,
        question,
        system_id=system_id,
        client=ctx.deps.client,
        username=ctx.deps.username,
        k=ctx.deps.k,
        mode=ctx.deps.mode,
        rrf_k=ctx.deps.rrf_k,
    )

    enriched = register_passages(ctx.deps.retrieved, passages)
    block = format_passage_block(enriched)
    logger.info(
        "agent.tool.reviewed_judgments",
        extra={"question": question[:120], "passages": len(enriched)},
    )
    return block or "(no passages retrieved)"


@agent.tool
async def retrieve_system_evidence(
    ctx: RunContext[AgentDeps],
    question: str,
) -> str:
    """Retrieve passages from the AI system's own documentation relevant to *question*.

    The system being assessed is implicitly bound to this tool — you do not need to
    specify it.  Use this tool to find the system's technical architecture, training
    data descriptions, risk assessments, conformity documentation, and any other
    system-level evidence.

    Returns a numbered block of passages with their ref_ids.  Use the ref_ids in
    your ``source_references`` field.
    """
    source_label = "system_evidence"
    # system_evidence always targets the run's registered AI system.
    system_id = ctx.deps.system_id
    backend_name = ctx.deps.source_backends.get(source_label, "classic")
    backend = get_backend(backend_name)

    passages = await backend.retrieve(
        source_label,
        question,
        system_id=system_id,
        client=ctx.deps.client,
        username=ctx.deps.username,
        k=ctx.deps.k,
        mode=ctx.deps.mode,
        rrf_k=ctx.deps.rrf_k,
    )

    enriched = register_passages(ctx.deps.retrieved, passages)
    block = format_passage_block(enriched)
    logger.info(
        "agent.tool.system_evidence",
        extra={
            "question": question[:120],
            "system_id": system_id,
            "passages": len(enriched),
        },
    )
    return block or "(no passages retrieved)"


# ---------------------------------------------------------------------------
# Output validator
# ---------------------------------------------------------------------------


def validate_task_result(
    retrieved: dict[str, dict],
    result: TaskResult,
) -> TaskResult:
    """Validate and potentially amend a TaskResult.

    Rules (in order):
    1. If *retrieved* is empty, raise ``ModelRetry`` — the agent must call at
       least one retrieval tool before producing output.
    2. Collect ``source_references`` whose ref_id is not in *retrieved*.  If
       any are found, set ``review_required=True`` and add a review question
       naming them (but do NOT hard-fail — the agent may have invented plausible
       IDs that should be flagged for humans).
    3. If ``review_questions`` is non-empty (for any reason), force
       ``review_required=True``.

    Returns the (possibly amended) TaskResult.
    """
    # Rule 1 — must retrieve before answering.
    if not retrieved:
        raise ModelRetry(
            "You must retrieve evidence via the tools before producing a result. "
            "Call retrieve_legal_sources, retrieve_reviewed_judgments, or "
            "retrieve_system_evidence first."
        )

    # Rule 2 — flag unresolved ref_ids.
    unresolved = [
        sr.ref_id for sr in result.source_references if sr.ref_id not in retrieved
    ]
    if unresolved:
        result = result.model_copy(
            update={
                "review_required": True,
                "review_questions": [
                    *result.review_questions,
                    (
                        f"The following cited ref_ids were not found in retrieved "
                        f"passages and could not be verified: {', '.join(unresolved)}"
                    ),
                ],
            }
        )

    # Rule 3 — coerce review_required when review_questions is non-empty.
    if result.review_questions and not result.review_required:
        result = result.model_copy(update={"review_required": True})

    return result


@agent.output_validator
async def _output_validator(
    ctx: RunContext[AgentDeps],
    result: TaskResult,
) -> TaskResult:
    return validate_task_result(ctx.deps.retrieved, result)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_task(
    *,
    task: str,
    system_id: str,
    questionnaire_context: str,
    source_backends: dict[str, str],
    knobs: dict,
    username: str,
) -> tuple[TaskResult, list[dict], dict]:
    """Run the task agent and return ``(result, passages, usage_dict)``.

    Parameters
    ----------
    task:
        The natural-language task for the agent (e.g. the risk-classification
        default prompt).
    system_id:
        ID of the registered AI system — used by ``retrieve_system_evidence``.
    questionnaire_context:
        Pre-formatted questionnaire string injected into the user prompt.
    source_backends:
        Maps ``legal`` / ``reviewed_judgments`` / ``system_evidence`` → backend
        name (``classic`` | ``graph`` | ``hierarchical``).
    knobs:
        Dict with ``k``, ``mode``, ``rrf_k`` retrieval parameters.
    username:
        Forwarded ``x-forwarded-preferred-username`` value.

    Returns
    -------
    tuple
        ``(TaskResult, list_of_passage_dicts, usage_dict)``
    """
    deps = AgentDeps(
        client=httpx.AsyncClient(timeout=30.0),
        username=username,
        system_id=system_id,
        source_backends=source_backends,
        k=knobs.get("k", 5),
        mode=knobs.get("mode", "hybrid"),
        rrf_k=knobs.get("rrf_k", 60),
    )

    user_prompt = (
        f"## QUESTIONNAIRE\n\n{questionnaire_context}\n\n---\n\n## TASK\n\n{task}"
    )

    async with deps.client:
        run_result = await agent.run(user_prompt, deps=deps)

    result: TaskResult = run_result.output
    passages: list[dict] = list(deps.retrieved.values())
    usage = run_result.usage()
    usage_dict = {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "total_tokens": usage.total_tokens,
    }

    logger.info(
        "agent.run.completed",
        extra={
            "system_id": system_id,
            "passages_retrieved": len(passages),
            "review_required": result.review_required,
            "input_tokens": usage_dict["input_tokens"],
            "output_tokens": usage_dict["output_tokens"],
        },
    )

    return result, passages, usage_dict
