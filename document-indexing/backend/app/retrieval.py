"""Hybrid retrieval: dense (pgvector cosine) + Postgres FTS, fused with RRF.

The reusable interface behind ``POST /v1/retrieve`` — one query + AI-system ID in,
ranked passages with source references out. No workflow-specific logic: every
consumer (assessment prefill, classification, evidence review) hits the same path.

Search is brute-force and always scoped ``WHERE ai_system_id = X`` (small per-system
space, no ANN index). Dense finds semantically similar passages even when wording
differs (AK 3); FTS ('simple', no stemming) matches exact terms/IDs (AK 4); RRF
fuses the two rank lists without needing comparable scores. Filters exclude
non-current versions (and, as an always-true no-op, non-deleted documents — delete is
now a hard delete) so updated documents behave per AK 7.
"""

from __future__ import annotations

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence.models import Document, DocumentChunk, DocumentVersion

from app import embedding_client

CANDIDATE_K = 50  # candidates pulled per channel before fusion
RRF_K = 60  # Reciprocal Rank Fusion constant


def _visible(stmt: Select) -> Select:
    """Restrict to indexed chunks of current, non-deleted documents for one system."""
    return (
        stmt.join(
            DocumentVersion, DocumentChunk.document_version_id == DocumentVersion.id
        )
        .join(Document, DocumentVersion.document_id == Document.id)
        .where(
            DocumentVersion.is_current.is_(True),
            DocumentVersion.status == "indexed",
            Document.deleted_at.is_(None),
        )
    )


def rrf_scores(rankings: list[list[str]], k: int = RRF_K) -> dict[str, float]:
    """Reciprocal Rank Fusion scores per chunk ID (ported from the Phase 1 harness)."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, cid in enumerate(ranking):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
    return scores


def rrf(rankings: list[list[str]], k: int = RRF_K, top: int | None = None) -> list[str]:
    """Chunk IDs ordered by their fused RRF score, highest first."""
    scores = rrf_scores(rankings, k)
    fused = sorted(scores, key=lambda c: scores[c], reverse=True)
    return fused[:top] if top else fused


async def _dense(
    session: AsyncSession, ai_system_id: str, query_vec: list[float]
) -> list[tuple[str, float]]:
    """``(chunk_id, cosine_similarity)`` for the top dense candidates, best first."""
    dist = DocumentChunk.embedding.cosine_distance(query_vec).label("dist")
    stmt = (
        _visible(
            select(DocumentChunk.id, dist).where(
                DocumentChunk.ai_system_id == ai_system_id,
                DocumentChunk.embedding.is_not(None),
            )
        )
        .order_by(dist)
        .limit(CANDIDATE_K)
    )
    rows = (await session.execute(stmt)).all()
    return [(cid, 1.0 - float(d)) for cid, d in rows]


async def _fts(
    session: AsyncSession, ai_system_id: str, query: str
) -> list[tuple[str, float]]:
    """``(chunk_id, ts_rank)`` for the top FTS candidates, best first."""
    tsquery = func.websearch_to_tsquery("simple", query)
    rank = func.ts_rank(DocumentChunk.content_tsv, tsquery).label("rank")
    stmt = (
        _visible(
            select(DocumentChunk.id, rank).where(
                DocumentChunk.ai_system_id == ai_system_id,
                DocumentChunk.content_tsv.op("@@")(tsquery),
            )
        )
        .order_by(rank.desc())
        .limit(CANDIDATE_K)
    )
    rows = (await session.execute(stmt)).all()
    return [(cid, float(r)) for cid, r in rows]


async def retrieve(
    session: AsyncSession,
    ai_system_id: str,
    query: str,
    k: int = 10,
    mode: str = "hybrid",
    rrf_k: int = RRF_K,
) -> list[dict]:
    """Return up to ``k`` passages, most relevant first, each with a source reference.

    ``mode`` ∈ ``hybrid`` (dense + FTS fused with RRF), ``dense``, ``fts``. A single-
    channel mode orders by that channel's own score and skips the other channel's work
    entirely (the dense modes still embed the query; ``fts`` does not). Each passage
    carries the per-channel rank/score diagnostics the Test Bed advanced panel surfaces."""
    want_dense = mode in ("dense", "hybrid")
    want_fts = mode in ("fts", "hybrid")

    dense: list[tuple[str, float]] = []
    lexical: list[tuple[str, float]] = []
    if want_dense:
        query_vec = await embedding_client.embed_one(query)
        dense = await _dense(session, ai_system_id, query_vec)
    if want_fts:
        lexical = await _fts(session, ai_system_id, query)

    dense_rank = {cid: i for i, (cid, _) in enumerate(dense)}
    dense_score = {cid: s for cid, s in dense}
    fts_rank = {cid: i for i, (cid, _) in enumerate(lexical)}
    fts_score = {cid: s for cid, s in lexical}

    if mode == "hybrid":
        fused_scores = rrf_scores(
            [[c for c, _ in dense], [c for c, _ in lexical]], rrf_k
        )
        fused = sorted(fused_scores, key=lambda c: fused_scores[c], reverse=True)[:k]
    elif mode == "dense":
        fused_scores = {}
        fused = [c for c, _ in dense][:k]
    else:  # fts
        fused_scores = {}
        fused = [c for c, _ in lexical][:k]
    if not fused:
        return []

    rows = (
        await session.execute(
            select(DocumentChunk, DocumentVersion, Document)
            .join(
                DocumentVersion,
                DocumentChunk.document_version_id == DocumentVersion.id,
            )
            .join(Document, DocumentVersion.document_id == Document.id)
            .where(DocumentChunk.id.in_(fused))
        )
    ).all()
    by_id = {chunk.id: (chunk, version, doc) for chunk, version, doc in rows}

    results: list[dict] = []
    for rank, cid in enumerate(fused):
        entry = by_id.get(cid)
        if entry is None:
            continue
        chunk, version, doc = entry
        results.append(
            {
                "chunk_id": chunk.id,
                "passage": chunk.text,
                # 1-based position in the fused ranking — a plain ordering number,
                # not a relevance/confidence score (RRF produces no absolute score).
                "rank": rank + 1,
                # Per-channel diagnostics (1-based rank + raw score, None if the chunk
                # did not surface in that channel); rrf_score only in hybrid mode.
                "dense_rank": dense_rank[cid] + 1 if cid in dense_rank else None,
                "dense_score": dense_score.get(cid),
                "fts_rank": fts_rank[cid] + 1 if cid in fts_rank else None,
                "fts_score": fts_score.get(cid),
                "rrf_score": fused_scores.get(cid),
                "source": {
                    "document_id": doc.id,
                    "version_id": version.id,
                    "version_label": version.version_label,
                    "filename": doc.filename,
                    "chunk_index": chunk.chunk_index,
                    "page": chunk.page,
                    "bbox": chunk.bbox,
                    "self_ref": chunk.self_ref,
                    "heading_path": chunk.heading_path,
                },
            }
        )
    return results
