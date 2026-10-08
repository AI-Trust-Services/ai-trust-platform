"""JSONB-backed stub KnowledgeBrain.

Stores all knowledge items in a Postgres JSONB column so the test bed works
without Cognee (#251). When Cognee lands, replace this class with a real
CogneeKnowledgeBrain adapter — the interface and all callers stay unchanged.

The stub stores items in the ``test_bed_runs`` table's ``payload`` JSONB under
a reserved sample_id sentinel (``__knowledge_brain__``) and kind
``knowledge_item``. For Phase 1 simplicity, items are loaded into memory at
query time (the volume is small: a handful of reviewed interpretations).
"""

from __future__ import annotations

import uuid
from typing import Any

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.test_bed import TestBedRun
from sqlalchemy import select

from app.testbed.knowledge_brain import KnowledgeBrain

_SENTINEL_SAMPLE_ID = "__knowledge_brain__"
_KIND = "knowledge_item"


class JsonbKnowledgeBrainStub(KnowledgeBrain):
    """Postgres JSONB-backed KnowledgeBrain stub for Phase 1."""

    async def add_reviewed_knowledge(
        self,
        content: str,
        source: str,
        kind: str,
        provenance: dict[str, Any],
    ) -> str:
        item_id = f"KB-{uuid.uuid4().hex[:8].upper()}"
        async with SessionLocal() as session:
            row = TestBedRun(
                id=item_id,
                kind=_KIND,
                sample_id=_SENTINEL_SAMPLE_ID,
                role="system",
                enabled_sources={},
                payload={
                    "content": content,
                    "source": source,
                    "knowledge_kind": kind,
                    "provenance": provenance,
                },
            )
            session.add(row)
            await session.commit()
        return item_id

    async def query(self, query_text: str, k: int = 5) -> list[dict]:
        # Simple substring search on content for the stub; Cognee will do
        # vector similarity search when #251 lands.
        async with SessionLocal() as session:
            rows = (
                (
                    await session.execute(
                        select(TestBedRun).where(
                            TestBedRun.sample_id == _SENTINEL_SAMPLE_ID,
                            TestBedRun.kind == _KIND,
                        )
                    )
                )
                .scalars()
                .all()
            )

        query_lower = query_text.lower()
        scored: list[tuple[float, dict]] = []
        for row in rows:
            p = row.payload or {}
            content = p.get("content", "")
            # Score = fraction of query words found in content.
            words = query_lower.split()
            hits = sum(1 for w in words if w in content.lower())
            score = hits / max(len(words), 1)
            scored.append((score, p))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item for _, item in scored[:k] if scored and scored[0][0] > 0]

    async def export(self) -> list[dict]:
        async with SessionLocal() as session:
            rows = (
                (
                    await session.execute(
                        select(TestBedRun).where(
                            TestBedRun.sample_id == _SENTINEL_SAMPLE_ID,
                            TestBedRun.kind == _KIND,
                        )
                    )
                )
                .scalars()
                .all()
            )
        return [row.payload for row in rows]

    async def import_items(self, items: list[dict]) -> int:
        added = 0
        for item in items:
            await self.add_reviewed_knowledge(
                content=item.get("content", ""),
                source=item.get("source", ""),
                kind=item.get("knowledge_kind", "imported"),
                provenance=item.get("provenance", {}),
            )
            added += 1
        return added


# Singleton for the document-indexing service.
knowledge_brain: KnowledgeBrain = JsonbKnowledgeBrainStub()
