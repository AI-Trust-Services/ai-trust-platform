"""Retrieval-Kanäle: dense (brute-force cosine), BM25, RRF-Fusion, Reranker.

Bewusst brute-force / exakt (kein ANN-Index): bei einem einzelnen AI-System ist die
Kandidatenmenge klein, und ein approximativer Index würde die Qualitäts-Messung
verrauschen (man wüsste bei einem Miss nicht, ob Embedding oder Index schuld ist).
"""

from __future__ import annotations

import re

import numpy as np

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def dense_rank(query_vec: np.ndarray, doc_matrix: np.ndarray) -> list[int]:
    """Chunk-Indizes absteigend nach Kosinus-Ähnlichkeit (exakt)."""
    scores = doc_matrix @ query_vec
    return np.argsort(-scores).tolist()


class BM25Channel:
    """Lexikalischer Kanal. In Phase 1 Stellvertreter für Postgres-FTS."""

    def __init__(self, texts: list[str]):
        from rank_bm25 import BM25Okapi

        self._bm25 = BM25Okapi([_tokenize(t) for t in texts])

    def rank(self, query: str) -> list[int]:
        scores = self._bm25.get_scores(_tokenize(query))
        return np.argsort(-scores).tolist()


def rrf(rankings: list[list[int]], k: int = 60, top: int | None = None) -> list[int]:
    """Reciprocal Rank Fusion über mehrere Ranglisten von Chunk-Indizes.

    RRF braucht keine Score-Normalisierung zwischen den (unvergleichbaren) Skalen
    von dense und BM25 — es zählt nur die Position in jeder Liste.
    """
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, idx in enumerate(ranking):
            scores[idx] = scores.get(idx, 0.0) + 1.0 / (k + rank + 1)
    fused = sorted(scores, key=lambda i: scores[i], reverse=True)
    return fused[:top] if top else fused


class Reranker:
    """Cross-Encoder-Reranker (bge-reranker-v2-m3), optionale letzte Stufe."""

    def __init__(self, model_name: str, use_fp16: bool = True):
        from FlagEmbedding import FlagReranker

        self._reranker = FlagReranker(model_name, use_fp16=use_fp16)

    def rerank(self, query: str, candidates: list[tuple[int, str]]) -> list[int]:
        """candidates: (chunk_index, text). Gibt Indizes absteigend nach Relevanz."""
        if not candidates:
            return []
        pairs = [[query, text] for _, text in candidates]
        scores = self._reranker.compute_score(pairs, normalize=True)
        if not isinstance(scores, list):
            scores = [scores]
        order = np.argsort(-np.asarray(scores)).tolist()
        return [candidates[i][0] for i in order]
