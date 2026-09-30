"""Embedding service — BGE-M3 dense vectors over HTTP.

A single process loads ``BAAI/bge-m3`` once (the model is ~2 GB) and serves dense
embeddings to both the indexing worker (index time) and the document-indexing backend
(query time). Serving it centrally guarantees index- and query-time embeddings come
from the *identical* model — a correctness requirement for hybrid retrieval — and
avoids loading the model twice.

Vectors are L2-normalised so cosine similarity equals the dot product, matching
experiments/document-indexing/embed.py and pgvector's cosine distance.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ai_trust_logging import get_logger

logger = get_logger(__name__)

EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
USE_FP16 = os.environ.get("EMBED_USE_FP16", "false").strip().lower() == "true"

_model = None


def _load_model():
    from FlagEmbedding import BGEM3FlagModel

    logger.info("embedding.model_loading", extra={"model": EMBED_MODEL})
    model = BGEM3FlagModel(EMBED_MODEL, use_fp16=USE_FP16)
    logger.info("embedding.model_loaded", extra={"model": EMBED_MODEL})
    return model


def _encode(texts: list[str]) -> list[list[float]]:
    import numpy as np

    out = _model.encode(
        texts, return_dense=True, return_sparse=False, return_colbert_vecs=False
    )
    vecs = np.asarray(out["dense_vecs"], dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    vecs = vecs / np.clip(norms, 1e-12, None)
    return vecs.tolist()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model
    # Load off the event loop; readiness (200 on /health) means the model is loaded.
    _model = await asyncio.to_thread(_load_model)
    yield


app = FastAPI(title="Embedding Service", version="1.0.0", lifespan=lifespan)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1)


class EmbedResponse(BaseModel):
    model: str
    dim: int
    vectors: list[list[float]]


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    vectors = await asyncio.to_thread(_encode, req.texts)
    return EmbedResponse(
        model=EMBED_MODEL, dim=len(vectors[0]) if vectors else 0, vectors=vectors
    )


@app.get("/health")
async def health() -> JSONResponse:
    if _model is None:
        return JSONResponse({"status": "loading"}, status_code=503)
    return JSONResponse({"status": "ok", "model": EMBED_MODEL})
