"""Client for the shared embedding service (BGE-M3 dense vectors over HTTP).

Both this backend (query embeddings) and the indexing worker (passage embeddings)
call the same service so index- and query-time vectors are identical.
"""

from __future__ import annotations

import os

import httpx


def _service_url() -> str:
    return os.environ["EMBEDDING_SERVICE_URL"].rstrip("/")


def _timeout() -> float:
    return float(os.environ.get("EMBEDDING_TIMEOUT", "60"))


async def embed(texts: list[str]) -> list[list[float]]:
    """Return one L2-normalised dense vector per input text."""
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(f"{_service_url()}/embed", json={"texts": texts})
        resp.raise_for_status()
        return resp.json()["vectors"]


async def embed_one(text: str) -> list[float]:
    return (await embed([text]))[0]
