"""Agent router — knowledge-grounded task agent endpoints.

All routes are prefixed ``/testbed/agent`` and gated by the ``systems:read``
permission (same as the test-bed router).

Endpoints
---------
- ``POST /testbed/agent/run`` — run the agent against a registered AI system
- ``GET /testbed/agent/runs`` — list recent agent runs (summaries)
- ``GET /testbed/agent/runs/{run_id}`` — get a single agent run (full)
- ``POST /testbed/agent/feedback`` — submit cognee feedback for a run
- ``POST /testbed/agent/cognee/ingest`` — proxy file upload to cognee
"""

from __future__ import annotations

import os

import httpx
from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.test_bed import TestBedRun
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.agent.task_agent import run_task
from app.ids import new_id

router = APIRouter(tags=["agent"])
logger = get_logger(__name__)

_REGISTRY_URL = os.environ.get(
    "REGISTRY_BACKEND_URL", "http://ai-system-registry-backend:8001"
)
_COGNEE_URL = os.environ.get("COGNEE_EVAL_URL", "http://cognee-eval-backend:8014")

# Lazily loaded default task text.
_DEFAULT_TASK: str | None = None


def _get_default_task() -> str:
    global _DEFAULT_TASK
    if _DEFAULT_TASK is None:
        from pathlib import Path

        _DEFAULT_TASK = (
            Path(__file__).parent.parent
            / "agent"
            / "prompts"
            / "risk_classification.md"
        ).read_text(encoding="utf-8")
    return _DEFAULT_TASK


def _format_questionnaire(qa: dict | None) -> str:
    """Format questionnaire_answers dict as a readable Markdown string."""
    if not qa:
        return "No questionnaire data available for this system."

    lines: list[str] = []
    business = {k: v for k, v in qa.items() if k != "technical"}
    technical: dict = qa.get("technical") or {}

    if business:
        lines.append("### Business Answers")
        for k, v in business.items():
            lines.append(f"- **{k}**: {v}")

    if technical:
        lines.append("\n### Technical Answers")
        for k, v in technical.items():
            lines.append(f"- **{k}**: {v}")

    return (
        "\n".join(lines)
        if lines
        else "No questionnaire data available for this system."
    )


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class SourceBackendsSchema(BaseModel):
    legal: str = "classic"
    reviewed_judgments: str = "classic"
    system_evidence: str = "classic"


class AgentRunRequest(BaseModel):
    system_id: str
    task: str | None = None
    source_backends: SourceBackendsSchema = Field(default_factory=SourceBackendsSchema)
    model: str | None = None
    retrieval_k: int = 5
    retrieval_mode: str = "hybrid"
    retrieval_rrf_k: int = 60


class FeedbackRequest(BaseModel):
    run_id: str
    conclusion: str
    reasoning: str
    question: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _fetch_system(system_id: str, username: str) -> dict:
    """Fetch the AI system from the registry; raise HTTPException on failure."""
    url = f"{_REGISTRY_URL}/v1/systems/{system_id}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                url,
                headers={"x-forwarded-preferred-username": username},
            )
    except httpx.RequestError as exc:
        logger.error(
            "agent.registry_unreachable",
            extra={"system_id": system_id, "error": str(exc)},
        )
        raise HTTPException(
            status_code=502, detail="Registry backend is unavailable"
        ) from exc

    if resp.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail=f"AI system '{system_id}' not found in the registry",
        )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Registry returned {resp.status_code}: {resp.text[:200]}",
        )
    return resp.json()


# ---------------------------------------------------------------------------
# POST /testbed/agent/run
# ---------------------------------------------------------------------------


@router.post(
    "/testbed/agent/run",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def agent_run(body: AgentRunRequest, request: Request) -> dict:
    """Run the knowledge-grounded task agent against a registered AI system.

    Body fields:
      - system_id (str, required) — ID of the registered AI system
      - task (str | null) — task for the agent; defaults to EU AI Act
        risk-classification if omitted
      - source_backends ({legal, reviewed_judgments, system_evidence}: str) —
        backend name per source (``classic`` | ``graph`` | ``hierarchical``),
        defaults all to ``classic``
      - model (str | null) — LLM model override (passed through env AGENT_MODEL
        if null)
      - retrieval_k (int, default 5) — passages to retrieve per source
      - retrieval_mode (str, default "hybrid") — "hybrid" | "dense" | "fts"
      - retrieval_rrf_k (int, default 60) — RRF fusion constant
    """
    username: str = request.headers.get("x-forwarded-preferred-username", "unknown")

    # 1. Fetch system + questionnaire from registry.
    system_data = await _fetch_system(body.system_id, username)
    questionnaire_context = _format_questionnaire(
        system_data.get("questionnaire_answers")
    )

    # 2. Determine task.
    task = body.task or _get_default_task()

    # 3. Build source_backends dict.
    sb = body.source_backends
    source_backends = {
        "legal": sb.legal,
        "reviewed_judgments": sb.reviewed_judgments,
        "system_evidence": sb.system_evidence,
    }

    knobs = {
        "k": body.retrieval_k,
        "mode": body.retrieval_mode,
        "rrf_k": body.retrieval_rrf_k,
    }

    # 4. Run the agent.
    result, retrieved_passages, usage = await run_task(
        task=task,
        system_id=body.system_id,
        questionnaire_context=questionnaire_context,
        source_backends=source_backends,
        knobs=knobs,
        username=username,
    )

    # 5. Enrich source_references with resolved flag.
    retrieved_ids = {p["ref_id"] for p in retrieved_passages}
    result_dict = result.model_dump()
    for sr in result_dict.get("source_references", []):
        sr["resolved"] = sr["ref_id"] in retrieved_ids

    # 6. Persist TestBedRun.
    run_id = new_id("TBR")
    async with SessionLocal() as session:
        row = TestBedRun(
            id=run_id,
            kind="agent_run",
            sample_id=body.system_id,
            role="agent",
            enabled_sources=source_backends,
            model=body.model,
            knowledge_revision=None,
            prompt_revision="default",
            payload={
                "system_id": body.system_id,
                "task": task,
                "source_backends": source_backends,
                "result": result_dict,
                "retrieved_passages": retrieved_passages,
                "usage": usage,
            },
            created_by=username,
        )
        session.add(row)
        await session.commit()

    logger.info(
        "agent_run.created",
        extra={
            "run_id": run_id,
            "system_id": body.system_id,
            "review_required": result.review_required,
        },
    )

    return {
        "run_id": run_id,
        "system_id": body.system_id,
        "task": task,
        "source_backends": source_backends,
        "result": result_dict,
        "retrieved_passages": retrieved_passages,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by": username,
    }


# ---------------------------------------------------------------------------
# GET /testbed/agent/runs
# ---------------------------------------------------------------------------


@router.get(
    "/testbed/agent/runs",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def list_agent_runs() -> list[dict]:
    """List the 50 most recent agent runs (summaries)."""
    async with SessionLocal() as session:
        stmt = (
            select(TestBedRun)
            .where(TestBedRun.kind == "agent_run")
            .order_by(TestBedRun.created_at.desc())
            .limit(50)
        )
        rows = (await session.execute(stmt)).scalars().all()

    return [
        {
            "run_id": row.id,
            "system_id": (row.payload or {}).get("system_id", row.sample_id),
            "task": (row.payload or {}).get("task", ""),
            "source_backends": row.enabled_sources,
            "review_required": (row.payload or {})
            .get("result", {})
            .get("review_required", False),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "created_by": row.created_by,
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# GET /testbed/agent/runs/{run_id}
# ---------------------------------------------------------------------------


@router.get(
    "/testbed/agent/runs/{run_id}",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def get_agent_run(run_id: str) -> dict:
    """Get a single agent run with full result and retrieved passages."""
    async with SessionLocal() as session:
        row = await session.get(TestBedRun, run_id)

    if row is None or row.kind != "agent_run":
        raise HTTPException(status_code=404, detail=f"Agent run '{run_id}' not found")

    payload = row.payload or {}
    return {
        "run_id": row.id,
        "system_id": payload.get("system_id", row.sample_id),
        "task": payload.get("task", ""),
        "source_backends": row.enabled_sources,
        "result": payload.get("result", {}),
        "retrieved_passages": payload.get("retrieved_passages", []),
        "usage": payload.get("usage", {}),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by": row.created_by,
    }


# ---------------------------------------------------------------------------
# POST /testbed/agent/feedback
# ---------------------------------------------------------------------------


@router.post(
    "/testbed/agent/feedback",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def agent_feedback(body: FeedbackRequest, request: Request) -> dict:
    """Submit a cognee feedback loop for an agent run.

    Orchestration (calls cognee):
    1. ``POST /v1/evaluate`` with *question* (derived from run task if omitted)
    2. ``POST /v1/feedback`` with evaluation_id + conclusion + reasoning +
       supporting_node_ids from the evaluation's source_evidence
    3. ``PATCH /v1/feedback/{id}/approve``

    Returns ``{feedback_id, status}``.  Returns 503 if cognee is unreachable.
    """
    username: str = request.headers.get("x-forwarded-preferred-username", "unknown")

    # Load the run to derive the question if not provided.
    async with SessionLocal() as session:
        row = await session.get(TestBedRun, body.run_id)

    if row is None or row.kind != "agent_run":
        raise HTTPException(
            status_code=404, detail=f"Agent run '{body.run_id}' not found"
        )

    question = body.question or (row.payload or {}).get("task", "Compliance evaluation")

    headers = {"x-forwarded-preferred-username": username}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Step 1: evaluate
            eval_resp = await client.post(
                f"{_COGNEE_URL}/v1/evaluate",
                json={"question": question},
                headers=headers,
            )
            if eval_resp.status_code not in (200, 201):
                raise HTTPException(
                    status_code=502,
                    detail=f"Cognee evaluate returned {eval_resp.status_code}: {eval_resp.text[:200]}",
                )
            eval_data = eval_resp.json()
            evaluation_id: str = eval_data["id"]
            supporting_node_ids: list[str] = [
                item["node_id"]
                for item in eval_data.get("source_evidence", [])
                if item.get("node_id")
            ]

            # Step 2: feedback
            fb_resp = await client.post(
                f"{_COGNEE_URL}/v1/feedback",
                json={
                    "evaluation_id": evaluation_id,
                    "conclusion": body.conclusion,
                    "reasoning": body.reasoning,
                    "supporting_node_ids": supporting_node_ids,
                },
                headers=headers,
            )
            if fb_resp.status_code not in (200, 201):
                raise HTTPException(
                    status_code=502,
                    detail=f"Cognee feedback returned {fb_resp.status_code}: {fb_resp.text[:200]}",
                )
            feedback_id: str = fb_resp.json()["id"]

            # Step 3: approve
            approve_resp = await client.patch(
                f"{_COGNEE_URL}/v1/feedback/{feedback_id}/approve",
                headers=headers,
            )
            if approve_resp.status_code not in (200, 202):
                raise HTTPException(
                    status_code=502,
                    detail=f"Cognee approve returned {approve_resp.status_code}: {approve_resp.text[:200]}",
                )

    except httpx.RequestError as exc:
        logger.warning(
            "agent.feedback.cognee_unreachable",
            extra={"run_id": body.run_id, "error": str(exc)},
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Cognee evaluation service is unreachable. "
                "Ensure the cognee-eval-backend is running and healthy."
            ),
        ) from exc

    logger.info(
        "agent_feedback.created",
        extra={"feedback_id": feedback_id, "run_id": body.run_id},
    )
    # approve runs the cognee re-ingestion in the background (202); the feedback
    # transitions approving → approved|failed asynchronously. Report the state we
    # know now rather than claiming completion.
    return {"feedback_id": feedback_id, "status": "approving"}


# ---------------------------------------------------------------------------
# POST /testbed/agent/cognee/ingest
# ---------------------------------------------------------------------------


@router.post(
    "/testbed/agent/cognee/ingest",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def cognee_ingest(file: UploadFile, request: Request) -> dict:
    """Proxy a file upload to the Cognee ingest endpoint.

    Forwards ``x-forwarded-preferred-username`` so Cognee can enforce its own
    access checks.  Returns 503 if Cognee is unreachable.
    """
    username: str = request.headers.get("x-forwarded-preferred-username", "unknown")
    data = await file.read()

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{_COGNEE_URL}/v1/ingest",
                files={"file": (file.filename, data, file.content_type)},
                headers={"x-forwarded-preferred-username": username},
            )
    except httpx.RequestError as exc:
        logger.warning(
            "agent.cognee_ingest.unreachable",
            extra={"file_name": file.filename, "error": str(exc)},
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Cognee evaluation service is unreachable. "
                "Ensure the cognee-eval-backend is running and healthy."
            ),
        ) from exc

    if resp.status_code not in (200, 201, 202):
        raise HTTPException(
            status_code=502,
            detail=f"Cognee ingest returned {resp.status_code}: {resp.text[:200]}",
        )

    logger.info(
        "agent.cognee_ingest.completed",
        extra={"file_name": file.filename, "status": resp.status_code},
    )
    return resp.json() if resp.text else {"status": "accepted"}
