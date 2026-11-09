"""AI-powered questionnaire answer pipeline.

Reads AI system registration data and optional RAG documents, calls the LLM
using the configured system prompt and questionnaire, and persists the result
as a versioned JSON file in MinIO.

Storage key layout:
    questionnaire-results/{system_id}/{questionnaire_id}/{iso_timestamp}.json

Each pipeline run appends a new file — old runs are never overwritten, giving a
full version history keyed by when the run was triggered (typically after a
system data update).
"""

from __future__ import annotations

import asyncio
import io
import json
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from ai_trust_logging import correlation_id_var, get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from sqlalchemy import select

from app.llm.client import chat
from app.llm.parsing import LLMParseError, parse_json_response
from app.llm.templates import load_questionnaire, load_template
from app import minio_client

logger = get_logger(__name__)

_INDEXING_URL = os.environ.get(
    "INDEXING_BACKEND_URL", "http://document-indexing-backend:8011"
).rstrip("/")

_QUESTIONNAIRE_BUCKET = "registration-docs"
_RAG_QUERY = "AI system description purpose capabilities deployment risks"
_RAG_K = 10
_QUESTIONNAIRE_MAX_TOKENS = int(os.environ.get("QUESTIONNAIRE_MAX_TOKENS", "32000"))


def _validate_llm_output(raw: dict) -> dict:
    """Validate the minimum structural contract: non-empty results list with questionIds.

    Field-level strictness is intentionally relaxed — real LLMs occasionally
    emit string fragments inside array fields, and we prefer to persist a
    slightly malformed result over returning a 502 to the user.
    """
    results = raw.get("results")
    if not isinstance(results, list) or len(results) == 0:
        raise LLMParseError("LLM output missing or empty 'results' list")
    missing_ids = [
        i
        for i, r in enumerate(results)
        if not isinstance(r, dict) or not r.get("questionId")
    ]
    if missing_ids:
        raise LLMParseError(
            f"LLM output has {len(missing_ids)} result(s) missing 'questionId' "
            f"at indices {missing_ids[:5]}"
        )
    return raw


def _system_evidence(row: AISystem) -> str:
    """Serialise the AI system row as a structured evidence block for the LLM."""
    fields = {
        "name": row.name,
        "version": row.version,
        "provider": row.provider,
        "org_name": row.org_name,
        "org_role": row.org_role,
        "description": row.description,
        "intended_purpose": row.intended_purpose,
        "department": row.department,
        "use_case": row.use_case,
        "people_affected": row.people_affected,
        "decision_context": row.decision_context,
        "system_type": row.system_type,
        "autonomy_level": row.autonomy_level,
        "lifecycle": row.lifecycle,
        "deployment_country": row.deployment_country,
        "is_gpai": row.is_gpai,
        "is_chatbot": row.is_chatbot,
        "generates_synthetic_content": row.generates_synthetic_content,
        "tier": row.tier,
    }
    # Include questionnaire answers if already collected via the workflow.
    if row.questionnaire_answers:
        fields["questionnaire_answers"] = row.questionnaire_answers

    lines = ["Registration Data — AI System Inventory\n"]
    for key, value in fields.items():
        if value is not None and value != "":
            lines.append(f"  {key}: {value}")
    return "\n".join(lines)


async def _retrieve_rag_documents(system_id: str, username: str) -> list[dict]:
    """Retrieve RAG document chunks for the system. Returns empty list on any failure."""
    payload = {
        "ai_system_id": system_id,
        "query": _RAG_QUERY,
        "k": _RAG_K,
        "mode": "hybrid",
    }
    headers = {"x-forwarded-preferred-username": username}
    cid = correlation_id_var.get("")
    if cid:
        headers["x-correlation-id"] = cid

    url = f"{_INDEXING_URL}/v1/retrieve"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code >= 400:
            logger.warning(
                "questionnaire_pipeline.rag_unavailable",
                extra={"system_id": system_id, "status": resp.status_code},
            )
            return []
        data = resp.json()
        return data.get("results", data) if isinstance(data, dict) else data
    except Exception as exc:
        logger.warning(
            "questionnaire_pipeline.rag_failed",
            extra={"system_id": system_id, "error": str(exc)},
        )
        return []


def _build_user_message(
    questionnaire: dict,
    registration_evidence: str,
    rag_chunks: list[dict],
) -> str:
    """Assemble the user message: questionnaire config + all evidence."""
    parts = [
        "Questionnaire Configuration:",
        json.dumps(questionnaire, indent=2),
        "",
        "Provided Evidence:",
        "",
        registration_evidence,
    ]

    if rag_chunks:
        parts.append("")
        parts.append("Documents:")
        for i, chunk in enumerate(rag_chunks, 1):
            source_ref = chunk.get("source") or {}
            source = source_ref.get("filename", f"Document {i}")
            content = chunk.get("passage", "")
            parts.append(f"\n[Document {i}] Source: {source}\n{content}")

    return "\n".join(parts)


def _split_by_dependency_groups(questionnaire: dict) -> list[dict]:
    """Split the questionnaire into independent dependency branches.

    Each branch is a connected component of the ``appliesWhen`` graph: two
    questions end up in the same batch when one references the other (directly
    or transitively).  Standalone questions (no ``appliesWhen`` and not
    referenced by any condition) each form their own single-question batch and
    are answered in parallel with everything else.

    Falls back to a single batch (the full questionnaire) when no ``appliesWhen``
    references exist at all.
    """
    questions = questionnaire.get("questions", [])
    metadata = {k: v for k, v in questionnaire.items() if k != "questions"}

    if not questions:
        return [questionnaire]

    id_to_idx: dict[str, int] = {q["id"]: i for i, q in enumerate(questions)}

    parent = list(range(len(questions)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    def _collect_refs(node: dict | list) -> list[str]:
        if isinstance(node, list):
            out: list[str] = []
            for item in node:
                out.extend(_collect_refs(item))
            return out
        if isinstance(node, dict):
            if "questionId" in node:
                return [node["questionId"]]
            out = []
            for v in node.values():
                out.extend(_collect_refs(v))
            return out
        return []

    has_any_dependency = False
    for i, q in enumerate(questions):
        applies = q.get("appliesWhen")
        if not applies:
            continue
        has_any_dependency = True
        for ref_id in _collect_refs(applies):
            if ref_id in id_to_idx:
                union(i, id_to_idx[ref_id])

    if not has_any_dependency:
        return [questionnaire]

    buckets: dict[int, list[dict]] = {}
    for i, q in enumerate(questions):
        root = find(i)
        if root not in buckets:
            buckets[root] = []
        buckets[root].append(q)

    ordered = sorted(buckets.values(), key=lambda qs: id_to_idx[qs[0]["id"]])
    return [{**metadata, "questions": qs} for qs in ordered]


async def _run_batch(
    batch: dict,
    system_prompt: str,
    registration_evidence: str,
    rag_chunks: list[dict],
    batch_idx: int,
) -> list[dict]:
    """Run one LLM call for a batch (category slice) of the questionnaire.

    Returns the ``results`` list from the LLM response.
    Raises ``LLMParseError`` on truncation or unparseable output.
    """
    task = f"questionnaire_answer_batch_{batch_idx}"
    user_message = _build_user_message(batch, registration_evidence, rag_chunks)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    llm_response = await chat(
        messages,
        task=task,
        json_mode=True,
        max_tokens=_QUESTIONNAIRE_MAX_TOKENS,
    )

    if llm_response.get("finish_reason") == "length":
        category = batch.get("questions", [{}])[0].get("category", str(batch_idx))
        raise LLMParseError(
            f"LLM output truncated (finish_reason=length) for batch '{category}': "
            f"input={llm_response.get('input_tokens', '?')} "
            f"output={llm_response.get('output_tokens', '?')} tokens."
        )

    parsed = await parse_json_response(
        llm_response["text"],
        task=task,
        max_tokens=_QUESTIONNAIRE_MAX_TOKENS,
    )
    _validate_llm_output(parsed)
    return parsed.get("results", [])


async def _upload_result(
    system_id: str,
    questionnaire_id: str,
    result: dict,
    timestamp: datetime,
) -> str:
    """Upload the result JSON to MinIO. Returns the object key."""
    iso = timestamp.strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    key = f"questionnaire-results/{system_id}/{questionnaire_id}/{iso}.json"
    data = json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8")

    await minio_client.ensure_bucket()

    from app.minio_client import _get_client  # reuse existing singleton

    def _put() -> None:
        _get_client().put_object(
            _QUESTIONNAIRE_BUCKET,
            key,
            io.BytesIO(data),
            length=len(data),
            content_type="application/json",
        )

    await asyncio.to_thread(_put)
    logger.info(
        "questionnaire_pipeline.result_stored",
        extra={"system_id": system_id, "key": key, "size": len(data)},
    )
    return key


async def run_pipeline_sequential(
    system_id: str,
    questionnaire_id: str,
    prompt_id: str,
    username: str,
    batch_callback: Any,  # async callable(batch_results: list[dict]) -> None
) -> dict[str, Any]:
    """Like ``run_pipeline`` but fires batches **sequentially**, calling
    ``batch_callback(results)`` after each one completes.

    This allows callers to persist partial results to the DB after each batch
    so they are visible via polling before the full pipeline finishes.

    ``batch_callback`` is ``async``.  If a batch raises, the exception propagates
    and no further batches are run.

    Returns ``{run_key, presigned_url, result}`` exactly like ``run_pipeline``.
    """
    # 1. Load system row.
    async with SessionLocal() as session:
        row = (
            await session.execute(select(AISystem).where(AISystem.id == system_id))
        ).scalar_one_or_none()
    if row is None:
        raise KeyError(f"AI system '{system_id}' not found")

    # 2. Load questionnaire config and system prompt.
    questionnaire = load_questionnaire(questionnaire_id)
    system_prompt = load_template(prompt_id)

    # 3. Evidence.
    registration_evidence = _system_evidence(row)
    rag_chunks = await _retrieve_rag_documents(system_id, username)
    if rag_chunks:
        logger.info(
            "questionnaire_pipeline.rag_retrieved",
            extra={"system_id": system_id, "chunks": len(rag_chunks)},
        )
    else:
        logger.info(
            "questionnaire_pipeline.rag_skipped",
            extra={"system_id": system_id},
        )

    # 4. Split and run PARALLEL — all independent dependency groups fire at once.
    # Each batch calls batch_callback as soon as it finishes so partial results
    # land in the DB and are visible via polling before the slowest batch completes.
    batches = _split_by_dependency_groups(questionnaire)
    logger.info(
        "questionnaire_pipeline.batched_parallel",
        extra={"system_id": system_id, "batches": len(batches)},
    )

    async def _run_and_callback(idx: int, batch: dict) -> list[dict]:
        results = await _run_batch(
            batch, system_prompt, registration_evidence, rag_chunks, idx
        )
        await batch_callback(results)
        return results

    batch_results_list = await asyncio.gather(
        *[_run_and_callback(idx, batch) for idx, batch in enumerate(batches)]
    )
    merged: list[dict] = []
    for br in batch_results_list:
        merged.extend(br)

    result = {"results": merged}

    # 5. Persist to MinIO.
    timestamp = datetime.now(timezone.utc)
    run_key = await _upload_result(system_id, questionnaire_id, result, timestamp)
    presigned_url = await minio_client.get_presigned_url(run_key, expires_hours=24)

    logger.info(
        "questionnaire_pipeline.completed",
        extra={
            "system_id": system_id,
            "questionnaire_id": questionnaire_id,
            "prompt_id": prompt_id,
            "questions_answered": len(result.get("results", [])),
            "run_key": run_key,
        },
    )

    return {
        "run_key": run_key,
        "presigned_url": presigned_url,
        "result": result,
    }


async def run_pipeline(
    system_id: str,
    questionnaire_id: str,
    prompt_id: str,
    username: str,
) -> dict[str, Any]:
    """Run the questionnaire answer pipeline for a given AI system.

    Returns ``{run_key, presigned_url, result}`` where ``result`` is the full
    parsed LLM output ``{"results": [...]}``.

    Raises:
        KeyError: system not found (caller maps to 404).
        PromptTemplateError: questionnaire or prompt file not found (caller maps to 404).
        LLMParseError: LLM returned unparseable JSON after repair retry (caller maps to 502).
    """
    # 1. Load system row.
    async with SessionLocal() as session:
        row = (
            await session.execute(select(AISystem).where(AISystem.id == system_id))
        ).scalar_one_or_none()
    if row is None:
        raise KeyError(f"AI system '{system_id}' not found")

    # 2. Load questionnaire config and system prompt (raises PromptTemplateError if missing).
    questionnaire = load_questionnaire(questionnaire_id)
    system_prompt = load_template(prompt_id)

    # 3. Build evidence — registration data (always) + RAG documents (best-effort).
    registration_evidence = _system_evidence(row)
    rag_chunks = await _retrieve_rag_documents(system_id, username)
    if rag_chunks:
        logger.info(
            "questionnaire_pipeline.rag_retrieved",
            extra={"system_id": system_id, "chunks": len(rag_chunks)},
        )
    else:
        logger.info(
            "questionnaire_pipeline.rag_skipped",
            extra={"system_id": system_id},
        )

    # 4. Split questionnaire into dependency-independent groups and run in parallel.
    batches = _split_by_dependency_groups(questionnaire)
    logger.info(
        "questionnaire_pipeline.batched",
        extra={"system_id": system_id, "batches": len(batches)},
    )

    batch_results = await asyncio.gather(
        *[
            _run_batch(batch, system_prompt, registration_evidence, rag_chunks, idx)
            for idx, batch in enumerate(batches)
        ]
    )

    # Merge in category order — each batch result is a list[dict].
    merged: list[dict] = []
    for batch_list in batch_results:
        merged.extend(batch_list)
    result = {"results": merged}

    # 5. Persist to MinIO.
    timestamp = datetime.now(timezone.utc)
    run_key = await _upload_result(system_id, questionnaire_id, result, timestamp)
    presigned_url = await minio_client.get_presigned_url(run_key, expires_hours=24)

    logger.info(
        "questionnaire_pipeline.completed",
        extra={
            "system_id": system_id,
            "questionnaire_id": questionnaire_id,
            "prompt_id": prompt_id,
            "questions_answered": len(result.get("results", [])),
            "run_key": run_key,
        },
    )

    return {
        "run_key": run_key,
        "presigned_url": presigned_url,
        "result": result,
    }
