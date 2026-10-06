"""Thin wrapper around Cognee 1.6.x pipeline for the EU AI Act evaluation.

Configuration is driven entirely by environment variables set in docker-compose.yml.
When SAP AI Core credentials are present, a thin OpenAI-compatible adapter route is
registered at /internal/v1/chat/completions and cognee's extraction stage is pointed
at it. The adapter fetches a Bearer token from SAP AI Core, calls {deployment}/invoke
(bedrock-style), and returns an OpenAI-compatible response.
"""

import asyncio
import os
import time
from pathlib import Path
from typing import Any

import httpx
import cognee
from cognee.modules.search.types.SearchType import SearchType

_DATASET = "eu_ai_act_v1"

# ── SAP AI Core token cache (shared with the adapter route) ──────────────────
_ai_token: str = ""
_ai_token_expiry: float = 0.0
_ai_token_lock = asyncio.Lock()

_AI_CLIENT_ID = os.environ.get("AI_CLIENT_ID", "")
_AI_CLIENT_SECRET = os.environ.get("AI_CLIENT_SECRET", "")
_AI_AUTH_URL = os.environ.get("AI_AUTH_URL", "")
_AI_DEPLOYMENT_ENDPOINT = os.environ.get("LLM_EXTRACTION_ENDPOINT", "")
_AI_RESOURCE_GROUP = os.environ.get("AI_RESOURCE_GROUP", "default")
_AI_API_VERSION = os.environ.get("AI_API_VERSION", "bedrock-2023-05-31")


async def get_sap_token() -> str:
    global _ai_token, _ai_token_expiry
    async with _ai_token_lock:
        if _ai_token and time.monotonic() < _ai_token_expiry - 60:
            return _ai_token
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                _AI_AUTH_URL,
                data={"grant_type": "client_credentials"},
                auth=(_AI_CLIENT_ID, _AI_CLIENT_SECRET),
            )
        resp.raise_for_status()
        data = resp.json()
        _ai_token = data["access_token"]
        _ai_token_expiry = time.monotonic() + data.get("expires_in", 43200)
        return _ai_token


def _sap_ai_configured() -> bool:
    return bool(_AI_CLIENT_ID and _AI_CLIENT_SECRET and _AI_AUTH_URL and _AI_DEPLOYMENT_ENDPOINT)


async def setup_sap_ai_core(app_port: int = 8011) -> bool:
    """Configure all cognee LLM stages to use the in-process SAP AI Core adapter.

    Points both the main and extraction-stage LLM endpoints at
    localhost:{app_port}/internal/v1 so all cognee LLM calls go through SAP AI
    Core. Returns True if configured, False if credentials are absent.
    """
    if not _sap_ai_configured():
        return False

    # Pre-fetch the token to fail fast if credentials are wrong.
    await get_sap_token()

    local_endpoint = f"http://localhost:{app_port}/internal/v1"
    cognee.config.set_llm_config({
        # openai/sap-ai-core: litellm routes to openai provider (hits our adapter)
        # but doesn't recognise the model name as schema-native, so it takes the
        # json-object fallback path which injects the schema into the prompt.
        "llm_provider": "openai",
        "llm_model": "openai/sap-ai-core",
        "llm_endpoint": local_endpoint,
        "llm_api_key": "sap-ai-core-local",
        "llm_extraction_provider": "openai",
        "llm_extraction_model": "openai/sap-ai-core",
        "llm_extraction_endpoint": local_endpoint,
        "llm_extraction_api_key": "sap-ai-core-local",
    })
    return True


async def ingest_pdf(pdf_path: str) -> dict:
    """Ingest the EU AI Act PDF into Cognee.

    Runs the full pipeline: text extraction → chunking → embedding →
    entity extraction → Kuzu graph build.
    """
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    await cognee.remember(str(path), dataset_name=_DATASET)
    return {"dataset": _DATASET, "source": str(path)}


async def get_ingest_status() -> dict:
    """Return ingestion status from Cognee's internal dataset registry."""
    try:
        # cognee.datasets() returns a lazy object; call .list_datasets() to get ORM rows
        dataset_list = await cognee.datasets().list_datasets()
        dataset_list = dataset_list if dataset_list else []
        match = next(
            (d for d in dataset_list if getattr(d, "name", None) == _DATASET),
            None,
        )
        return {
            "dataset": _DATASET,
            "ingested": match is not None,
            "all_datasets": [getattr(d, "name", str(d)) for d in dataset_list],
        }
    except Exception as e:  # noqa: BLE001
        return {"dataset": _DATASET, "ingested": False, "error": str(e)}


async def recall(query: str) -> list[dict]:
    """Semantic + graph retrieval via cognee.recall()."""
    results = await cognee.recall(query_text=query)
    out = []
    for r in results or []:
        # RecallResponse entries are discriminated unions — extract text-like fields
        text = getattr(r, "answer", None) or getattr(r, "text", None) or str(r)
        node_id = str(getattr(r, "id", getattr(r, "node_id", "")))
        score = getattr(r, "score", None)
        out.append({"text": text, "node_id": node_id, "score": score})
    return out


async def get_graph_stats() -> dict:
    """Return a high-level summary of the knowledge graph."""
    results = await cognee.search(
        "List all entity types and relationship types in the knowledge graph",
        SearchType.GRAPH_COMPLETION,
    )
    summaries = []
    for r in results or []:
        text = getattr(r, "answer", None) or getattr(r, "text", None) or str(r)
        summaries.append(text)
    return {"summary": summaries}


async def search_entities(entity_type: str | None = None, limit: int = 50) -> list[dict]:
    """Return entities from the graph, optionally filtered by type."""
    query = f"List {entity_type} entities" if entity_type else "List all entities"
    results = await cognee.search(query, SearchType.GRAPH_COMPLETION)
    out = []
    for r in (results or [])[:limit]:
        text = getattr(r, "answer", None) or getattr(r, "text", None) or str(r)
        node_id = str(getattr(r, "id", getattr(r, "node_id", "")))
        out.append({"text": text, "node_id": node_id})
    return out


async def answer_question(question: str, passages: list[dict], app_port: int = 8011) -> str:
    """Generate a grounded answer using the in-process SAP AI Core adapter.

    Falls back to a plain concatenation of passages when SAP AI Core is not
    configured (e.g. Ollama-only mode).
    """
    if not _sap_ai_configured():
        if not passages:
            return "No relevant passages found in the knowledge graph."
        return "\n\n".join(p["text"] for p in passages[:5])

    context = "\n\n".join(
        f"[{i+1}] {p['text']}" for i, p in enumerate(passages[:5])
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You are an EU AI Act compliance expert. "
                "Answer the question using only the provided passages. "
                "If the passages do not contain enough information, say so."
            ),
        },
        {
            "role": "user",
            "content": f"Passages:\n{context}\n\nQuestion: {question}",
        },
    ]
    token = await get_sap_token()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"http://localhost:{app_port}/internal/v1/chat/completions",
            json={"model": "openai/sap-ai-core", "messages": messages, "max_tokens": 2048},
            headers={"Authorization": f"Bearer {token}"},
        )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


async def ingest_feedback(feedback_id: str, text: str, node_ids: list[str]) -> None:
    """Ingest approved feedback as a tagged node into Cognee's graph.

    Stored in a separate dataset to keep source text and human
    interpretation distinguishable.
    """
    tagged = f"[FEEDBACK:{feedback_id}] {text}\nLinked provisions: {', '.join(node_ids)}"
    await cognee.remember(tagged, dataset_name=f"feedback_{feedback_id}")
