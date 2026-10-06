"""POST /v1/testbed/run  +  GET /v1/testbed/runs — AI Test Bed orchestrator.

Orchestrates a side-effect-free classification run:
  1. Load the sample fixture (answers, context).
  2. For each enabled source, retrieve relevant passages.
  3. Assemble injected_context from the passages.
  4. Call the registry's /v1/classify/evaluate endpoint.
  5. Persist a test_bed_runs row.
  6. Return the result with source passages.

The registry HTTP call passes the same x-forwarded-preferred-username header so
the registry's permission check is satisfied without a separate auth token.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.test_bed import TestBedRun

from app.ids import new_id
from app.retrieval import retrieve as db_retrieve
from app.testbed.samples_loader import get_sample, list_samples

router = APIRouter(tags=["testbed"])
logger = get_logger(__name__)

_REGISTRY_URL = os.environ.get(
    "REGISTRY_BACKEND_URL", "http://ai-system-registry-backend:8001"
)

# Sentinel AI-system id used to store the EU AI Act document index.
_EU_AI_ACT_SYSTEM_ID = "__eu_ai_act__"

_RETRIEVE_K = 5  # passages to pull per enabled source


def _format_passages_as_context(passages: list[dict], label: str) -> str:
    if not passages:
        return ""
    lines = [f"### {label}"]
    for i, p in enumerate(passages, 1):
        src = p.get("source", {})
        ref = src.get("filename", "")
        if src.get("page"):
            ref += f", p. {src['page']}"
        lines.append(f"\n[{i}] {ref}\n{p.get('passage', '')}")
    return "\n".join(lines)


@router.get(
    "/testbed/samples",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def list_samples_endpoint() -> list[dict]:
    """List available test-bed sample fixtures."""
    return list_samples()


@router.post(
    "/testbed/run",
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def run_testbed(request: Request) -> dict:
    """Run an interactive classification against a sample fixture.

    Body fields:
      - sample_id (str, required)
      - role (str, default "engineer") — "engineer" | "compliance_officer"
      - enabled_sources (dict) — {system_docs: bool, eu_ai_act: bool, cognee: bool}
      - prompt_override (str | null)
      - model (str | null)
    """
    body = await request.json()
    sample_id: str = body.get("sample_id", "")
    role: str = body.get("role", "engineer")
    enabled_sources: dict = body.get("enabled_sources", {})
    prompt_override: str | None = body.get("prompt_override") or None
    model: str | None = body.get("model") or None
    created_by: str = request.headers.get("x-forwarded-preferred-username", "unknown")

    sample = get_sample(sample_id)
    if sample is None:
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' not found")

    business_answers: dict = sample.get("business_answers") or {}
    technical_answers: dict = sample.get("technical_answers") or {}

    # Normalise multiline YAML values to single-space strings.
    business_answers = {
        k: " ".join(str(v).split()) for k, v in business_answers.items()
    }
    technical_answers = {
        k: " ".join(str(v).split()) for k, v in technical_answers.items()
    }

    # Assemble injected context from enabled sources.
    context_blocks: list[str] = []
    source_passages: list[dict] = []
    query_text = (
        business_answers.get("intended_purpose", "")
        + " "
        + business_answers.get("use_case", "")
    ).strip()

    async with SessionLocal() as session:
        if enabled_sources.get("system_docs") and query_text:
            sys_id = sample.get("ai_system_id")
            if sys_id:
                passages = await db_retrieve(session, sys_id, query_text, k=_RETRIEVE_K)
                if passages:
                    source_passages.extend(
                        [{**p, "_source_label": "system_docs"} for p in passages]
                    )
                    context_blocks.append(
                        _format_passages_as_context(passages, "System documents")
                    )

        if enabled_sources.get("eu_ai_act") and query_text:
            passages = await db_retrieve(
                session, _EU_AI_ACT_SYSTEM_ID, query_text, k=_RETRIEVE_K
            )
            if passages:
                source_passages.extend(
                    [{**p, "_source_label": "eu_ai_act"} for p in passages]
                )
                context_blocks.append(
                    _format_passages_as_context(passages, "EU AI Act")
                )

    if enabled_sources.get("cognee") and query_text:
        from app.testbed.knowledge_brain_stub import knowledge_brain

        kb_items = await knowledge_brain.query(query_text, k=_RETRIEVE_K)
        if kb_items:
            lines = ["### Reviewed expert knowledge"]
            for i, item in enumerate(kb_items, 1):
                lines.append(
                    f"\n[{i}] {item.get('source', 'knowledge base')}\n{item.get('content', '')}"
                )
            context_blocks.append("\n".join(lines))
            source_passages.extend(
                [{**item, "_source_label": "cognee"} for item in kb_items]
            )

    injected_context = "\n\n".join(context_blocks)

    # Call the registry's evaluate endpoint.
    username_header = request.headers.get("x-forwarded-preferred-username", "unknown")
    evaluate_url = f"{_REGISTRY_URL}/v1/classify/evaluate"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                evaluate_url,
                json={
                    "answers": {
                        "business": business_answers,
                        "technical": technical_answers,
                    },
                    "enabled_sources": enabled_sources,
                    "injected_context": injected_context,
                    "prompt_override": prompt_override,
                    "model": model,
                },
                headers={"x-forwarded-preferred-username": username_header},
            )
    except httpx.RequestError as exc:
        logger.error("testbed.registry_unreachable", extra={"error": str(exc)})
        raise HTTPException(
            status_code=502, detail="Registry backend is unavailable"
        ) from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Registry evaluate returned {resp.status_code}: {resp.text[:200]}",
        )

    result = resp.json()

    # Persist the run.
    run_id = new_id("TBR")
    async with SessionLocal() as session:
        row = TestBedRun(
            id=run_id,
            kind="run",
            sample_id=sample_id,
            role=role,
            prompt_revision="default",
            enabled_sources=enabled_sources,
            model=model,
            knowledge_revision=None,
            payload={
                "input": {
                    "business_answers": business_answers,
                    "technical_answers": technical_answers,
                    "prompt_override": prompt_override,
                    "injected_context": injected_context,
                },
                "output": result,
            },
            created_by=created_by,
        )
        session.add(row)
        await session.commit()

    logger.info(
        "testbed.run.created",
        extra={
            "run_id": run_id,
            "sample_id": sample_id,
            "tier": result.get("tier"),
            "role": role,
        },
    )

    return {
        "run_id": run_id,
        "sample_id": sample_id,
        "role": role,
        "tier": result.get("tier"),
        "basis": result.get("basis"),
        "obligations": result.get("obligations", []),
        "confidence": result.get("confidence"),
        "rationale": result.get("rationale"),
        "source_passages": source_passages,
        "enabled_sources": enabled_sources,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": created_by,
    }


@router.get(
    "/testbed/runs",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def list_runs(sample_id: str | None = None) -> list[dict]:
    """List test-bed runs, optionally filtered by sample_id."""
    async with SessionLocal() as session:
        stmt = select(TestBedRun).where(TestBedRun.kind == "run")
        if sample_id:
            stmt = stmt.where(TestBedRun.sample_id == sample_id)
        stmt = stmt.order_by(TestBedRun.created_at.desc()).limit(50)
        rows = (await session.execute(stmt)).scalars().all()

    return [
        {
            "run_id": row.id,
            "sample_id": row.sample_id,
            "role": row.role,
            "enabled_sources": row.enabled_sources,
            "model": row.model,
            "tier": (row.payload or {}).get("output", {}).get("tier"),
            "confidence": (row.payload or {}).get("output", {}).get("confidence"),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "created_by": row.created_by,
        }
        for row in rows
    ]


@router.get(
    "/testbed/runs/{run_id}",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def get_run(run_id: str) -> dict:
    """Get a single test-bed run with full payload."""
    async with SessionLocal() as session:
        row = await session.get(TestBedRun, run_id)

    if row is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    payload = row.payload or {}
    output = payload.get("output", {})
    return {
        "run_id": row.id,
        "sample_id": row.sample_id,
        "role": row.role,
        "enabled_sources": row.enabled_sources,
        "model": row.model,
        "prompt_revision": row.prompt_revision,
        "tier": output.get("tier"),
        "basis": output.get("basis"),
        "obligations": output.get("obligations", []),
        "confidence": output.get("confidence"),
        "rationale": output.get("rationale"),
        "source_passages": payload.get("input", {}).get("source_passages", []),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by": row.created_by,
    }
