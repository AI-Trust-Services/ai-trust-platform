"""Thin wrapper around the Cognee 1.6.x pipeline for the EU AI Act evaluation.

Configuration is driven entirely by environment variables injected by the Helm deployment.
All cognee generation (main + extraction) is pointed at the standalone ai-gateway
service via the LLM_*/LLM_EXTRACTION_* env vars; grounded answers call the same gateway
directly. Embeddings run in-process via fastembed (BAAI/bge-small-en-v1.5).
"""

import os
from pathlib import Path

import httpx
import cognee
import kuzu
from cognee.modules.search.types.SearchType import SearchType

_DATASET = "eu_ai_act_v1"

_GATEWAY_URL = os.environ.get("LLM_ENDPOINT", "http://ai-gateway:8000/v1")
_GATEWAY_MODEL = os.environ.get("LLM_MODEL", "ai-gateway")
_EMBEDDING_PROVIDER = os.environ.get("COGNEE_EMBEDDING_PROVIDER", "fastembed")
_EMBEDDING_MODEL = os.environ.get("COGNEE_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
_EMBEDDING_DIMENSIONS = int(os.environ.get("COGNEE_EMBEDDING_DIMENSIONS", "384"))


def setup_cognee() -> None:
    """Configure cognee to use ai-gateway for LLM and fastembed for embeddings."""
    cognee.config.set_llm_config(
        {
            "llm_provider": "openai",
            "llm_model": f"openai/{_GATEWAY_MODEL}",
            "llm_endpoint": _GATEWAY_URL,
            "llm_api_key": "ai-gateway",
            "llm_extraction_provider": "openai",
            "llm_extraction_model": f"openai/{_GATEWAY_MODEL}",
            "llm_extraction_endpoint": _GATEWAY_URL,
            "llm_extraction_api_key": "ai-gateway",
        }
    )
    cognee.config.set_embedding_provider(_EMBEDDING_PROVIDER)
    cognee.config.set_embedding_model(_EMBEDDING_MODEL)
    cognee.config.set_embedding_dimensions(_EMBEDDING_DIMENSIONS)


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


_PROBE_QUERY = "What are the obligations for high-risk AI systems?"


async def consistency_check() -> tuple[bool, str]:
    """Verify the on-disk graph snapshot is present and internally consistent.

    Run at startup in read-only prod before serving traffic: a torn or empty
    snapshot (e.g. a bad artifact) must fail readiness rather than serve wrong
    answers. Confirms a recall() returns at least one node id that actually
    resolves in the Kuzu graph on disk.
    """
    # Local import avoids a router<->client import cycle at module load.
    from app.routers.graph import find_graph_db

    db_path = find_graph_db()
    if not db_path:
        return False, "no graph database found on disk"

    try:
        results = await recall(_PROBE_QUERY)
    except Exception as e:  # noqa: BLE001
        return False, f"recall failed: {e}"

    node_ids = [r["node_id"] for r in results if r.get("node_id")]
    if not node_ids:
        return False, "recall returned no resolvable node ids"

    db = kuzu.Database(db_path, read_only=True)
    conn = kuzu.Connection(db)
    try:
        for node_id in node_ids:
            r = conn.execute(
                "MATCH (n:Node {id: $id}) RETURN n.id LIMIT 1", {"id": node_id}
            )
            if r.has_next():
                return True, f"graph consistent (resolved node {node_id})"
    finally:
        conn.close()
        db.close()

    return False, "no recalled node id resolved in the graph"
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
    """Generate a grounded answer via the AI gateway."""
    if not passages:
        return "No relevant passages found in the knowledge graph."

    context = "\n\n".join(f"[{i + 1}] {p['text']}" for i, p in enumerate(passages[:5]))
    messages = [
        {
            "role": "system",
            "content": (
                "You are an EU AI Act compliance expert. "
                "Answer ONLY using the provided passages. "
                "If the passages do not contain information relevant to the question, "
                "respond with exactly: 'The knowledge graph does not contain information about this topic.' "
                "Do NOT use any external knowledge or training data under any circumstances."
            ),
        },
        {
            "role": "user",
            "content": f"Passages:\n{context}\n\nQuestion: {question}",
        },
    ]
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{_GATEWAY_URL.rstrip('/')}/chat/completions",
            json={"model": _GATEWAY_MODEL, "messages": messages, "max_tokens": 2048},
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
