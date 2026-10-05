"""Hybrid retrieval: dense (pgvector cosine) + Postgres FTS, fused with RRF.

The reusable interface behind ``POST /v1/retrieve`` — one query + AI-system ID in,
ranked passages with source references out. No workflow-specific logic: every
consumer (assessment prefill, classification, evidence review) hits the same path.

Search is brute-force and always scoped ``WHERE ai_system_id = X`` (small per-system
space, no ANN index). Dense finds semantically similar passages even when wording
differs (AK 3); FTS ('simple', no stemming) matches exact terms/IDs (AK 4); RRF
fuses the two rank lists without needing comparable scores. Filters exclude
non-current versions and soft-deleted documents so updated/deleted docs behave per AK 7.
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


def rrf(rankings: list[list[str]], k: int = RRF_K, top: int | None = None) -> list[str]:
    """Reciprocal Rank Fusion over chunk-ID rank lists (ported from the Phase 1 harness)."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, cid in enumerate(ranking):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
    fused = sorted(scores, key=lambda c: scores[c], reverse=True)
    return fused[:top] if top else fused


async def _dense_ids(
    session: AsyncSession, ai_system_id: str, query_vec: list[float]
) -> list[str]:
    stmt = _visible(
        select(DocumentChunk.id).where(
            DocumentChunk.ai_system_id == ai_system_id,
            DocumentChunk.embedding.is_not(None),
        )
    ).order_by(DocumentChunk.embedding.cosine_distance(query_vec)).limit(CANDIDATE_K)
    return list((await session.execute(stmt)).scalars().all())


async def _fts_ids(
    session: AsyncSession, ai_system_id: str, query: str
) -> list[str]:
    tsquery = func.websearch_to_tsquery("simple", query)
    stmt = (
        _visible(
            select(DocumentChunk.id).where(
                DocumentChunk.ai_system_id == ai_system_id,
                DocumentChunk.content_tsv.op("@@")(tsquery),
            )
        )
        .order_by(func.ts_rank(DocumentChunk.content_tsv, tsquery).desc())
        .limit(CANDIDATE_K)
    )
    return list((await session.execute(stmt)).scalars().all())


async def retrieve(
    session: AsyncSession, ai_system_id: str, query: str, k: int = 10
) -> list[dict]:
    """Return up to ``k`` passages, most relevant first, each with a source reference."""
    query_vec = await embedding_client.embed_one(query)

    dense = await _dense_ids(session, ai_system_id, query_vec)
    lexical = await _fts_ids(session, ai_system_id, query)
    fused = rrf([dense, lexical], top=k)
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
