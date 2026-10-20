"""Thin wrapper around the Cognee 1.6.x pipeline for the EU AI Act evaluation.

LLM and embedding provider/model are hardcoded in setup_cognee() — not env-configurable.
In live mode (THALAMUS_BASE_URL is a real URL) both generation and embeddings go through
Thalamus (OpenAI-compat). In stub/CI mode (unset or "stub") embeddings fall back to
in-process fastembed (local ONNX, no network).
"""

import os
from pathlib import Path

import httpx
import litellm
import cognee
from cognee.modules.search.types.SearchType import SearchType

_DATASET = "eu_ai_act_v1"

_THALAMUS_BASE_URL = os.environ.get("THALAMUS_BASE_URL", "")
_THALAMUS_MODEL = os.environ.get("THALAMUS_MODEL", "Qwen/Qwen3.8-27B")
_THALAMUS_BEARER_TOKEN = os.environ.get("THALAMUS_BEARER_TOKEN", "")
_LLM_RPM_LIMIT = int(os.environ.get("COGNEE_LLM_RATE_LIMIT_REQUESTS", "60"))

# Suppress cognee's first-use LLM/embedding connection probe — it can fail
# against OpenAI-compat endpoints even when real calls succeed, blocking the
# first ingest. Retries (litellm.num_retries) cover transient failures instead.
os.environ.setdefault("COGNEE_SKIP_CONNECTION_TEST", "true")

# Stub mode (unset/"stub") is used by tests/CI, which mock the whole cognee pipeline.
# A real gateway URL requires a bearer token — fail fast rather than 401 deep in httpx.
_STUB_MODE = _THALAMUS_BASE_URL.strip().lower() in ("", "stub")
if not _STUB_MODE and not _THALAMUS_BEARER_TOKEN:
    raise RuntimeError(
        "THALAMUS_BASE_URL is set to a real gateway but THALAMUS_BEARER_TOKEN is empty. "
        "Set the bearer token in the environment, or use THALAMUS_BASE_URL=stub for CI."
    )


def setup_cognee() -> None:
    """Configure cognee to use Thalamus for LLM and embeddings.

    In stub/CI mode (THALAMUS_BASE_URL unset or 'stub') only embeddings are
    configured (fastembed, local ONNX, no network); the LLM config is left at
    cognee's default. Ingest and recall will fail in stub mode because graph
    extraction requires a real LLM — this is expected (stub mode is for tests,
    which mock the whole cognee_client module).

    In live mode both LLM and embeddings go through Thalamus.
    """
    # Thalamus doesn't support the `dimensions` param that litellm may inject; drop it.
    litellm.drop_params = True
    # Retry individual LLM calls on 429/5xx — same behaviour the old ai-gateway
    # provided at the HTTP transport layer. litellm honors Retry-After headers
    # natively and falls back to exponential backoff when the header is absent.
    litellm.num_retries = 6
    # Cap requests per minute to stay within the gateway's sustained token quota.
    litellm.rpm_limit = _LLM_RPM_LIMIT
    if not _STUB_MODE:
        cognee.config.set_llm_config(
            {
                "llm_provider": "openai",
                "llm_model": f"openai/{_THALAMUS_MODEL}",
                "llm_endpoint": _THALAMUS_BASE_URL,
                "llm_api_key": _THALAMUS_BEARER_TOKEN,
                "llm_extraction_provider": "openai",
                "llm_extraction_model": f"openai/{_THALAMUS_MODEL}",
                "llm_extraction_endpoint": _THALAMUS_BASE_URL,
                "llm_extraction_api_key": _THALAMUS_BEARER_TOKEN,
            }
        )
    if _STUB_MODE:
        embedding_cfg: dict = {
            "embedding_provider": "fastembed",
            "embedding_model": "BAAI/bge-small-en-v1.5",
            "embedding_dimensions": 384,
        }
    else:
        embedding_cfg = {
            "embedding_provider": "openai",
            "embedding_model": "openai/Snowflake/snowflake-arctic-embed-m",
            "embedding_dimensions": 768,
            "embedding_endpoint": _THALAMUS_BASE_URL,
            "embedding_api_key": _THALAMUS_BEARER_TOKEN,
        }
    cognee.config.set_embedding_config(embedding_cfg)


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
    """Verify the graph snapshot is present and answerable before serving.

    Run at startup in read-only prod: a torn or empty snapshot (e.g. a bad
    artifact) must fail readiness rather than serve wrong answers. Validates
    through the same federated recall() path the product serves from, so it
    correctly accounts for the full graph (and any merged content) regardless
    of the on-disk dataset layout — and avoids opening a second Kuzu handle
    (which would contend with the live process's exclusive lock).
    """
    try:
        results = await recall(_PROBE_QUERY)
    except Exception as e:  # noqa: BLE001
        return False, f"recall failed: {e}"

    # A healthy graph returns at least one result with content. We check for
    # non-empty text rather than a node_id: recall results don't always expose
    # an id, but an empty/torn graph returns nothing retrievable at all.
    for r in results:
        if (r.get("text") or "").strip():
            return True, f"graph answerable ({len(results)} result(s))"

    return False, "recall returned nothing retrievable — graph missing or empty"


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
    """Generate a grounded answer via the AI gateway."""
    if _STUB_MODE:
        return "[Stub mode] Thalamus gateway not configured — set THALAMUS_BASE_URL to a real endpoint to enable grounded answers."
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
            f"{_THALAMUS_BASE_URL.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {_THALAMUS_BEARER_TOKEN}"},
            json={"model": _THALAMUS_MODEL, "messages": messages, "max_tokens": 2048},
        )
    resp.raise_for_status()
    choices = resp.json().get("choices") or []
    if not choices:
        return (
            "The model did not return an answer (content filtered or empty response)."
        )
    return (
        choices[0].get("message", {}).get("content")
        or "The model returned an empty answer."
    )


async def ingest_feedback(feedback_id: str, text: str, node_ids: list[str]) -> None:
    """Merge approved feedback into the main knowledge graph.

    Ingested into the same dataset as the source document so cognify() links
    the feedback's entities into the existing graph (true enrichment), keeping
    a single graph/.pkl for read-only snapshots. The [FEEDBACK:id] prefix
    preserves provenance within the one graph.
    """
    tagged = (
        f"[FEEDBACK:{feedback_id}] {text}\nLinked provisions: {', '.join(node_ids)}"
    )
    await cognee.remember(tagged, dataset_name=_DATASET)
