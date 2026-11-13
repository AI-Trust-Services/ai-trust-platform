"""Pipeline 1 — AI-powered questionnaire answer pipeline.

Reads AI system registration data and optional RAG documents, calls the LLM
using the configured system prompt and questionnaire, and persists the result
as a versioned JSON file in MinIO.

This is the **only** implementation of the questionnaire run. It is called by
``POST /questionnaire-llm-run`` (no callback) and by the AI-assessment prefill
pipeline (``app/assessment_prefill_pipeline.py``, with a per-batch callback that
saves answers as they arrive).

Storage key layout:
    questionnaire-results/{system_id}/{questionnaire_id}/{iso_timestamp}.json

Each pipeline run appends a new file — old runs are never overwritten, giving a
full version history keyed by when the run was triggered (typically after a
system data update).
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from functools import partial
from typing import Any

import httpx
from ai_trust_logging import correlation_id_var, get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from sqlalchemy import select

from app.llm.client import chat
from app.llm.parsing import LLMParseError, parse_with_retry
from app.llm.templates import load_questionnaire, load_template
from app.llm.validators import validate_questionnaire_batch
from app import minio_client

logger = get_logger(__name__)

_INDEXING_URL = os.environ.get(
    "INDEXING_BACKEND_URL", "http://document-indexing-backend:8011"
).rstrip("/")

# Defaults shared by every caller (the endpoint and the assessment prefill), so an
# empty-body request runs exactly the parameters the assessment runs.
DEFAULT_QUESTIONNAIRE_ID = "ai-questionnaire"
DEFAULT_QUESTIONNAIRE_PROMPT_ID = "questionnaire_answer"

_RAG_QUERY = "AI system description purpose capabilities deployment risks"
_RAG_K = 10
_QUESTIONNAIRE_MAX_TOKENS = int(os.environ.get("QUESTIONNAIRE_MAX_TOKENS", "24000"))


def _system_evidence(row: AISystem) -> str:
    """Serialise the AI system row as a structured evidence block for the LLM.

    **Allowlist — do not add columns here.** A field belongs in this block only if
    the user can *see it and change it* in the UI: a visible, editable value that is
    wrong can be discovered and corrected by its owner, an invisible one never can.
    These five are exactly the fields the registration form collects
    (``RegisterSystem.tsx``) and the "AI System Details" card edits
    (``SystemDetailPage.tsx``).

    Every other column on ``ai_systems`` is either a schema default nobody entered
    (``system_type='application'``, ``autonomy_level='decision_support'``,
    ``org_role='provider'``, ``version='1.0.0'``, the risk booleans — all
    ``NOT NULL`` with a default and collected by no UI), a derived value
    (``tier`` is the classifier's own output), or never populated
    (``department``/``use_case``/``people_affected``/``decision_context``). The
    system prompt declares this block authoritative evidence and grades anything
    stated here HIGH, so passing a default through makes the model answer
    confidently from a fact nobody asserted (issue #383). Everything substantive
    must come from the uploaded + indexed documents instead.

    ``questionnaire_answers`` is excluded for a different reason: those are the
    model's own prior answers to the same questions, and the prompt states
    "Questionnaire answers are not factual evidence for other questions".
    """
    fields = {
        "name": row.name,  # "Name of AI system"
        "intended_purpose": row.intended_purpose,  # "System Description"
        "lifecycle": row.lifecycle,  # "Development stage"
        "planned_rollout_date": row.planned_rollout_date,  # "Planned roll-out date"
        "git_repo_url": row.git_repo_url,  # "Github repository"
    }

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

    Returns the ``results`` list from the LLM response, validated against this
    batch's question config (ids, completeness, allowed values, strength rules).
    Raises ``LLMParseError`` on truncation or unparseable/invalid output after
    up to 3 total LLM attempts.
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

    parsed = await parse_with_retry(
        llm_response["text"],
        task=task,
        validator=partial(validate_questionnaire_batch, batch=batch),
        chat_fn=chat,
        messages=messages,
        max_attempts=3,
        max_tokens=_QUESTIONNAIRE_MAX_TOKENS,
    )
    return parsed.get("results", [])


def _result_key(system_id: str, questionnaire_id: str, timestamp: datetime) -> str:
    iso = timestamp.strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    return f"questionnaire-results/{system_id}/{questionnaire_id}/{iso}.json"


async def run_questionnaire_pipeline(
    system_id: str,
    questionnaire_id: str,
    prompt_id: str,
    username: str,
    batch_callback: Any = None,  # async callable(batch_results: list[dict]) -> None
) -> dict[str, Any]:
    """Run the questionnaire answer pipeline for a given AI system.

    Steps: load the system + questionnaire + prompt, build the evidence
    (allowlisted registration data + best-effort RAG chunks), split the
    questionnaire into independent dependency groups, run one LLM call per group
    **in parallel** (each validated against its group's question config, with
    retries), merge, and store the result in MinIO.

    ``batch_callback`` (optional) is awaited with each batch's validated
    ``results`` as soon as that batch completes, so callers can persist partial
    answers while slower batches are still running. Invocations are **serialised**
    by an internal lock, so a callback may safely read-modify-write shared state
    (e.g. the ``questionnaire_answers`` JSONB column). A batch whose LLM call,
    validation **or callback** raises is logged (``questionnaire_pipeline.
    batch_failed``) and skipped — it does not abort the other batches.

    Returns ``{run_key, presigned_url, result}`` where ``result`` is
    ``{"results": [...]}`` merged in category order.

    Raises:
        KeyError: system not found (caller maps to 404).
        PromptTemplateError: questionnaire or prompt file not found (caller maps to 404).
        LLMParseError: **no** batch produced a valid result (caller maps to 502).
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

    # 4. Split into dependency-independent groups and run them in parallel.
    batches = _split_by_dependency_groups(questionnaire)
    logger.info(
        "questionnaire_pipeline.batched",
        extra={"system_id": system_id, "batches": len(batches)},
    )

    callback_lock = asyncio.Lock()

    async def _run_and_callback(idx: int, batch: dict) -> list[dict]:
        results = await _run_batch(
            batch, system_prompt, registration_evidence, rag_chunks, idx
        )
        if batch_callback is not None:
            async with callback_lock:
                await batch_callback(results)
        return results

    outcomes = await asyncio.gather(
        *[_run_and_callback(idx, batch) for idx, batch in enumerate(batches)],
        return_exceptions=True,
    )

    # Merge in category order — each outcome is a list[dict]. Failed batches are
    # logged and skipped; their questions stay unanswered.
    merged: list[dict] = []
    failures: list[Exception] = []
    for idx, outcome in enumerate(outcomes):
        if isinstance(outcome, Exception):
            failures.append(outcome)
            logger.warning(
                "questionnaire_pipeline.batch_failed",
                extra={"system_id": system_id, "batch_idx": idx, "error": str(outcome)},
            )
        else:
            merged.extend(outcome)

    if batches and len(failures) == len(batches):
        # Nothing usable came back — surface it instead of reporting an empty run
        # as a success (the caller would otherwise show "0 answers" as done).
        raise LLMParseError(
            f"no questionnaire batch produced a valid result "
            f"({len(failures)}/{len(batches)} failed); first error: {failures[0]}"
        ) from failures[0]

    result = {"results": merged}

    # 5. Persist to MinIO.
    timestamp = datetime.now(timezone.utc)
    run_key = _result_key(system_id, questionnaire_id, timestamp)
    await minio_client.put_json(run_key, result)
    presigned_url = await minio_client.get_presigned_url(run_key, expires_hours=24)

    logger.info(
        "questionnaire_pipeline.completed",
        extra={
            "system_id": system_id,
            "questionnaire_id": questionnaire_id,
            "prompt_id": prompt_id,
            "questions_answered": len(result["results"]),
            "batches_failed": len(failures),
            "run_key": run_key,
        },
    )

    return {
        "run_key": run_key,
        "presigned_url": presigned_url,
        "result": result,
    }
