"""Thin wrapper around the Cognee 1.6.x pipeline for the EU AI Act evaluation.

Configuration is driven entirely by environment variables set in docker-compose.yml.
All cognee generation (main + extraction) is pointed at the standalone sap-ai-proxy
service via the LLM_*/LLM_EXTRACTION_* env vars; grounded answers call the same proxy
directly. Embeddings run in-process via fastembed (BAAI/bge-small-en-v1.5).
"""

import os
from pathlib import Path

import httpx
import cognee
from cognee.modules.search.types.SearchType import SearchType

_DATASET = "eu_ai_act_v1"

_SAP_PROXY_URL = os.environ.get("LLM_ENDPOINT", "http://sap-ai-proxy:8000/v1")
_SAP_MODEL = os.environ.get("LLM_MODEL", "sap-ai-core")


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


async def search_entities(
    entity_type: str | None = None, limit: int = 50
) -> list[dict]:
    """Return entities from the graph, optionally filtered by type."""
    query = f"List {entity_type} entities" if entity_type else "List all entities"
    results = await cognee.search(query, SearchType.GRAPH_COMPLETION)
    out = []
    for r in (results or [])[:limit]:
        text = getattr(r, "answer", None) or getattr(r, "text", None) or str(r)
        node_id = str(getattr(r, "id", getattr(r, "node_id", "")))
        out.append({"text": text, "node_id": node_id})
    return out


async def answer_question(question: str, passages: list[dict]) -> str:
    """Generate a grounded answer via the SAP AI Core proxy."""
    if not passages:
        return "No relevant passages found in the knowledge graph."

    context = "\n\n".join(f"[{i+1}] {p['text']}" for i, p in enumerate(passages[:5]))
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
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{_SAP_PROXY_URL.rstrip('/')}/chat/completions",
            json={"model": _SAP_MODEL, "messages": messages, "max_tokens": 2048},
        )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


async def ingest_feedback(feedback_id: str, text: str, node_ids: list[str]) -> None:
    """Ingest approved feedback as a tagged node into Cognee's graph.

    Stored in a separate dataset to keep source text and human
    interpretation distinguishable.
    """
    tagged = (
        f"[FEEDBACK:{feedback_id}] {text}\nLinked provisions: {', '.join(node_ids)}"
    )
    await cognee.remember(tagged, dataset_name=f"feedback_{feedback_id}")
