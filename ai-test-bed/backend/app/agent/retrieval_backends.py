"""Retrieval backend protocol and implementations.

Three named backends are available:

- ``classic`` — calls the document-indexing service ``POST /v1/retrieve``
  (dense + FTS hybrid RAG backed by pgvector).
- ``graph`` — calls the Cognee evaluation service ``POST /v1/recall``
  (graph-based semantic recall).
- ``hierarchical`` — stub (not yet implemented); returns an empty list and logs
  an info message.

Each backend returns a list of normalised passage dicts:

.. code-block:: python

    {
        "ref_id": "L-abc123",   # stable ref assigned by caller
        "text": "...",
        "source_label": "legal",
        "backend": "classic",
        "meta": {...},          # raw source info (filename, page, scores, …)
    }

Callers assign ``ref_id`` after retrieval via the ``citations`` module; the
backend itself does not set it.
"""

from __future__ import annotations

import os
from typing import Protocol, runtime_checkable

import httpx
from ai_trust_logging import get_logger

logger = get_logger(__name__)

_INDEXING_URL = os.environ.get(
    "INDEXING_BACKEND_URL", "http://document-indexing-backend:8011"
)
_COGNEE_URL = os.environ.get("COGNEE_EVAL_URL", "http://cognee-eval-backend:8014")


@runtime_checkable
class RetrievalBackend(Protocol):
    """Protocol for a pluggable retrieval backend."""

    async def retrieve(
        self,
        source_label: str,
        question: str,
        *,
        system_id: str,
        client: httpx.AsyncClient,
        username: str,
        k: int,
        mode: str,
        rrf_k: int,
    ) -> list[dict]:
        """Return normalised passages (without ref_id) for *question*.

        All non-200 responses and network errors MUST be caught and logged; an
        empty list is returned so the agent run is not aborted.
        """
        ...  # pragma: no cover


class ClassicRagBackend:
    """Backend that calls the document-indexing ``POST /v1/retrieve`` endpoint."""

    async def retrieve(
        self,
        source_label: str,
        question: str,
        *,
        system_id: str,
        client: httpx.AsyncClient,
        username: str,
        k: int,
        mode: str,
        rrf_k: int,
    ) -> list[dict]:
        url = f"{_INDEXING_URL}/v1/retrieve"
        try:
            resp = await client.post(
                url,
                json={
                    "ai_system_id": system_id,
                    "query": question,
                    "k": k,
                    "mode": mode,
                    "rrf_k": rrf_k,
                },
                headers={"x-forwarded-preferred-username": username},
            )
        except httpx.RequestError as exc:
            logger.warning(
                "agent.retrieve.failed",
                extra={
                    "backend": "classic",
                    "source_label": source_label,
                    "system_id": system_id,
                    "error": str(exc),
                },
            )
            return []

        if resp.status_code != 200:
            logger.warning(
                "agent.retrieve.failed",
                extra={
                    "backend": "classic",
                    "source_label": source_label,
                    "system_id": system_id,
                    "status": resp.status_code,
                },
            )
            return []

        raw: list[dict] = resp.json()
        return [
            {
                "text": p.get("passage", ""),
                "source_label": source_label,
                "backend": "classic",
                "meta": {
                    "chunk_id": p.get("chunk_id", ""),
                    "source": p.get("source", {}),
                    "dense_score": p.get("dense_score"),
                    "fts_score": p.get("fts_score"),
                    "rrf_score": p.get("rrf_score"),
                    "rank": p.get("rank"),
                },
            }
            for p in raw
        ]


class GraphBackend:
    """Backend that calls the Cognee ``POST /v1/recall`` endpoint."""

    async def retrieve(
        self,
        source_label: str,
        question: str,
        *,
        system_id: str,
        client: httpx.AsyncClient,
        username: str,
        k: int,
        mode: str = "hybrid",
        rrf_k: int = 60,
    ) -> list[dict]:
        url = f"{_COGNEE_URL}/v1/recall"
        try:
            resp = await client.post(
                url,
                json={"question": question, "k": k},
                headers={"x-forwarded-preferred-username": username},
            )
        except httpx.RequestError as exc:
            logger.warning(
                "agent.retrieve.failed",
                extra={
                    "backend": "graph",
                    "source_label": source_label,
                    "error": str(exc),
                },
            )
            return []

        if resp.status_code != 200:
            logger.warning(
                "agent.retrieve.failed",
                extra={
                    "backend": "graph",
                    "source_label": source_label,
                    "status": resp.status_code,
                },
            )
            return []

        raw: list[dict] = resp.json()
        return [
            {
                "text": item.get("text", ""),
                "source_label": source_label,
                "backend": "graph",
                "meta": {
                    "node_id": item.get("node_id", ""),
                    "score": item.get("score"),
                },
            }
            for item in raw
        ]


class HierarchicalBackend:
    """Stub for a future hierarchical retrieval backend (not yet implemented)."""

    async def retrieve(
        self,
        source_label: str,
        question: str,
        *,
        system_id: str,
        client: httpx.AsyncClient,
        username: str,
        k: int,
        mode: str = "hybrid",
        rrf_k: int = 60,
    ) -> list[dict]:
        logger.info(
            "agent.retrieve.hierarchical_stub",
            extra={"source_label": source_label, "note": "not available yet"},
        )
        return []


_BACKENDS: dict[str, RetrievalBackend] = {
    "classic": ClassicRagBackend(),
    "graph": GraphBackend(),
    "hierarchical": HierarchicalBackend(),
}


def get_backend(name: str) -> RetrievalBackend:
    """Return the named backend; raise ``ValueError`` for unknown names."""
    try:
        return _BACKENDS[name]
    except KeyError:
        raise ValueError(
            f"Unknown retrieval backend {name!r}. Valid values: {list(_BACKENDS)}"
        ) from None
