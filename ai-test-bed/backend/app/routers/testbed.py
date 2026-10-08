"""POST /v1/testbed/run  +  GET /v1/testbed/runs — AI Test Bed orchestrator.

Orchestrates a side-effect-free classification run:
  1. Load the sample fixture (answers, context).
  2. For each enabled source, retrieve relevant passages via the document-indexing
     HTTP endpoint (POST /v1/retrieve) — no in-process retrieval import.
  3. Assemble injected_context from the passages.
  4. Call the registry's /v1/classify/evaluate endpoint.
  5. Persist a test_bed_runs row.
  6. Return the result with source passages.

Both HTTP calls (retrieve + evaluate) forward x-forwarded-preferred-username so
downstream permission checks pass without a separate auth token.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.test_bed import TestBedRun
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.ids import new_id
from app.testbed.samples_loader import get_sample, list_samples

router = APIRouter(tags=["testbed"])
logger = get_logger(__name__)

_REGISTRY_URL = os.environ.get(
    "REGISTRY_BACKEND_URL", "http://ai-system-registry-backend:8001"
)
_INDEXING_URL = os.environ.get(
    "INDEXING_BACKEND_URL", "http://document-indexing-backend:8011"
)

# Sentinel AI-system id used to store the EU AI Act document index.
_EU_AI_ACT_SYSTEM_ID = "__eu_ai_act__"

# Default retrieval parameters when the caller omits them.
_DEFAULT_K = 5
_DEFAULT_MODE = "hybrid"
_DEFAULT_RRF_K = 60


class RunRequest(BaseModel):
    sample_id: str
    role: str = "engineer"
    enabled_sources: dict = {}
    prompt_override: str | None = None
    model: str | None = None
    retrieval_k: int = _DEFAULT_K
    retrieval_mode: str = _DEFAULT_MODE
    retrieval_rrf_k: int = _DEFAULT_RRF_K


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
    """List available test-bed sample fixtures (summary: id, name, description, expected_tier)."""
    return list_samples()


@router.get(
    "/testbed/samples/{sample_id}",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def get_sample_detail(sample_id: str) -> dict:
    """Return the full sample fixture including business/technical answers and expected_rationale."""
    sample = get_sample(sample_id)
    if sample is None:
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' not found")
    return {
        "id": sample["id"],
        "name": sample.get("name", sample["id"]),
        "description": str(sample.get("description", "")).strip(),
        "expected_tier": sample.get("expected_tier"),
        "expected_rationale": str(sample.get("expected_rationale", "")).strip(),
        "ai_system_id": sample.get("ai_system_id"),
        "business_answers": sample.get("business_answers") or {},
        "technical_answers": sample.get("technical_answers") or {},
    }


@router.post(
    "/testbed/run",
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def run_testbed(body: RunRequest, request: Request) -> dict:
    """Run an interactive classification against a sample fixture.

    Body fields:
      - sample_id (str, required)
      - role (str, default "engineer") — "engineer" | "compliance_officer"
      - enabled_sources (dict) — {system_docs: bool, eu_ai_act: bool, cognee: bool}
      - prompt_override (str | null)
      - model (str | null)
      - retrieval_k (int, default 5) — passages to retrieve per source
      - retrieval_mode (str, default "hybrid") — "hybrid" | "dense" | "fts"
      - retrieval_rrf_k (int, default 60) — RRF fusion constant (hybrid only)
    """
    sample_id = body.sample_id
    role = body.role
    enabled_sources = body.enabled_sources
    prompt_override = body.prompt_override
    model = body.model
    retrieval_k = body.retrieval_k
    retrieval_mode = body.retrieval_mode
    retrieval_rrf_k = body.retrieval_rrf_k
    username_header: str = request.headers.get(
        "x-forwarded-preferred-username", "unknown"
    )
    created_by: str = username_header

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

    query_text = (
        business_answers.get("intended_purpose", "")
        + " "
        + business_answers.get("use_case", "")
    ).strip()

    context_blocks: list[str] = []
    source_passages: list[dict] = []

    retrieve_url = f"{_INDEXING_URL}/v1/retrieve"
    retrieve_headers = {"x-forwarded-preferred-username": username_header}

    # HTTP retrieval + evaluate in a single client session for connection reuse.
    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- Retrieval: system_docs ---
        if enabled_sources.get("system_docs") and query_text:
            sys_id = sample.get("ai_system_id")
            if sys_id:
                try:
                    r = await client.post(
                        retrieve_url,
                        json={
                            "ai_system_id": sys_id,
                            "query": query_text,
                            "k": retrieval_k,
                            "mode": retrieval_mode,
                            "rrf_k": retrieval_rrf_k,
                        },
                        headers=retrieve_headers,
                    )
                    if r.status_code == 200:
                        passages = r.json()
                        if passages:
                            source_passages.extend(
                                [
                                    {**p, "_source_label": "system_docs"}
                                    for p in passages
                                ]
                            )
                            context_blocks.append(
                                _format_passages_as_context(
                                    passages, "System documents"
                                )
                            )
                except httpx.RequestError as exc:
                    logger.warning(
                        "testbed.retrieve.failed",
                        extra={"source": "system_docs", "error": str(exc)},
                    )

        # --- Retrieval: eu_ai_act ---
        if enabled_sources.get("eu_ai_act") and query_text:
            try:
                r = await client.post(
                    retrieve_url,
                    json={
                        "ai_system_id": _EU_AI_ACT_SYSTEM_ID,
                        "query": query_text,
                        "k": retrieval_k,
                        "mode": retrieval_mode,
                        "rrf_k": retrieval_rrf_k,
                    },
                    headers=retrieve_headers,
                )
                if r.status_code == 200:
                    passages = r.json()
                    if passages:
                        source_passages.extend(
                            [{**p, "_source_label": "eu_ai_act"} for p in passages]
                        )
                        context_blocks.append(
                            _format_passages_as_context(passages, "EU AI Act")
                        )
            except httpx.RequestError as exc:
                logger.warning(
                    "testbed.retrieve.failed",
                    extra={"source": "eu_ai_act", "error": str(exc)},
                )

        # --- KnowledgeBrain (Cognee stub, uses DB directly) ---
        if enabled_sources.get("cognee") and query_text:
            from app.testbed.knowledge_brain_stub import knowledge_brain

            kb_items = await knowledge_brain.query(query_text, k=retrieval_k)
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

        # --- Evaluate ---
        evaluate_url = f"{_REGISTRY_URL}/v1/classify/evaluate"
        try:
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
                    "role": role,
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

    retrieval_knobs = {
        "k": retrieval_k,
        "mode": retrieval_mode,
        "rrf_k": retrieval_rrf_k,
    }

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
                    "retrieval_knobs": retrieval_knobs,
                },
                "output": result,
                "source_passages": source_passages,
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
        "retrieval_knobs": retrieval_knobs,
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
        "retrieval_knobs": payload.get("input", {}).get("retrieval_knobs"),
        "tier": output.get("tier"),
        "basis": output.get("basis"),
        "obligations": output.get("obligations", []),
        "confidence": output.get("confidence"),
        "rationale": output.get("rationale"),
        "source_passages": payload.get("source_passages", []),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by": row.created_by,
    }
