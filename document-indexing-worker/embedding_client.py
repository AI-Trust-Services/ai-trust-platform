"""Client for the shared embedding service (BGE-M3 dense vectors over HTTP).

Batches passage embeddings so a large document doesn't send one giant request.
"""

from __future__ import annotations

import os

import httpx


def _service_url() -> str:
    return os.environ["EMBEDDING_SERVICE_URL"].rstrip("/")


async def embed(texts: list[str]) -> list[list[float]]:
    """Return one L2-normalised dense vector per text, batched."""
    timeout = float(os.environ.get("EMBEDDING_TIMEOUT", "120"))
    batch = int(os.environ.get("EMBEDDING_BATCH_SIZE", "64"))
    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        for i in range(0, len(texts), batch):
            resp = await client.post(
                f"{_service_url()}/embed", json={"texts": texts[i : i + batch]}
            )
            resp.raise_for_status()
            vectors.extend(resp.json()["vectors"])
    return vectors
