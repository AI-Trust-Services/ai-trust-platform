"""Embedding service — multilingual dense vectors over HTTP.

A single process loads the embedding model once and serves dense vectors to both the
indexing worker (index time, ``kind=passage``) and the document-indexing backend
(query time, ``kind=query``). Serving it centrally guarantees index- and query-time
embeddings come from the *identical* model — a correctness requirement for hybrid
retrieval — and avoids loading the model twice.

Two model families are supported, selected by ``EMBED_MODEL`` via a small registry:

- ``flagembedding``        — BGEM3FlagModel (``BAAI/bge-m3``), no input prefixes.
- ``sentence-transformers`` — the E5 family (e.g. ``intfloat/multilingual-e5-small``),
  which REQUIRES the prefixes ``query: `` / ``passage: `` (quality collapses without
  them). The service applies the right prefix from the request's ``kind`` so both
  callers stay consistent automatically.

Vectors are L2-normalised so cosine similarity equals the dot product, matching
pgvector's cosine distance.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ai_trust_logging import get_logger

logger = get_logger(__name__)

EMBED_MODEL = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")
USE_FP16 = os.environ.get("EMBED_USE_FP16", "false").strip().lower() == "true"

# Per-model backend + the prefixes E5 needs. query/passage prefix is chosen from the
# request `kind`; bge-m3 has empty prefixes so its path is unchanged.
MODELS: dict[str, dict[str, str]] = {
    "BAAI/bge-m3": {
        "backend": "flagembedding",
        "query_prefix": "",
        "passage_prefix": "",
    },
    "intfloat/multilingual-e5-small": {  # 384-dim, ~118M params — fast on CPU
        "backend": "sentence-transformers",
        "query_prefix": "query: ",
        "passage_prefix": "passage: ",
    },
    "intfloat/multilingual-e5-base": {  # 768-dim, ~278M params
        "backend": "sentence-transformers",
        "query_prefix": "query: ",
        "passage_prefix": "passage: ",
    },
}


def _spec() -> dict[str, str]:
    try:
        return MODELS[EMBED_MODEL]
    except KeyError:
        known = ", ".join(MODELS)
        raise RuntimeError(f"Unknown EMBED_MODEL {EMBED_MODEL!r}. Known: {known}")


_model = None


def _load_model():
    spec = _spec()
    logger.info(
        "embedding.model_loading",
        extra={"model": EMBED_MODEL, "backend": spec["backend"]},
    )
    if spec["backend"] == "flagembedding":
        from FlagEmbedding import BGEM3FlagModel

        model = BGEM3FlagModel(EMBED_MODEL, use_fp16=USE_FP16)
    else:
        from sentence_transformers import SentenceTransformer

        # fp16 is ignored on CPU (no native fp16 matmul); normalisation is done in
        # _encode, not in the model, so both backends share one code path.
        model = SentenceTransformer(EMBED_MODEL)
    logger.info("embedding.model_loaded", extra={"model": EMBED_MODEL})
    return model


def _encode(texts: list[str], kind: str) -> list[list[float]]:
    import numpy as np

    spec = _spec()
    prefix = spec["passage_prefix"] if kind == "passage" else spec["query_prefix"]
    prefixed = [prefix + t for t in texts] if prefix else texts

    if spec["backend"] == "flagembedding":
        out = _model.encode(
            prefixed, return_dense=True, return_sparse=False, return_colbert_vecs=False
        )
        vecs = np.asarray(out["dense_vecs"], dtype=np.float32)
    else:
        vecs = np.asarray(
            _model.encode(
                prefixed,
                convert_to_numpy=True,
                normalize_embeddings=False,
                show_progress_bar=False,
            ),
            dtype=np.float32,
        )

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
    # Which E5 prefix to apply. The worker embeds passages (default), the backend
    # embeds the query. No-op for bge-m3 (empty prefixes).
    kind: Literal["passage", "query"] = "passage"


class EmbedResponse(BaseModel):
    model: str
    dim: int
    vectors: list[list[float]]


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    vectors = await asyncio.to_thread(_encode, req.texts, req.kind)
    return EmbedResponse(
        model=EMBED_MODEL, dim=len(vectors[0]) if vectors else 0, vectors=vectors
    )


@app.get("/health")
async def health() -> JSONResponse:
    if _model is None:
        return JSONResponse({"status": "loading"}, status_code=503)
    return JSONResponse({"status": "ok", "model": EMBED_MODEL})
