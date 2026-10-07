"""KnowledgeBrain — interface for reviewed knowledge storage and retrieval.

Thin abstraction so the test-bed orchestrator stays independent of the
underlying store. Phase 1 provides a JSONB-backed stub; when Cognee (#251)
lands, replace the stub implementation only — callers are unchanged.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class KnowledgeBrain(ABC):
    """Interface for managing reviewed expert knowledge used in classification."""

    @abstractmethod
    async def add_reviewed_knowledge(
        self,
        content: str,
        source: str,
        kind: str,
        provenance: dict[str, Any],
    ) -> str:
        """Store a reviewed knowledge item and return its id."""

    @abstractmethod
    async def query(self, query_text: str, k: int = 5) -> list[dict]:
        """Return up to k knowledge items relevant to query_text.

        Each item is a dict with at least ``content``, ``source``, ``kind``,
        and ``provenance`` keys.
        """

    @abstractmethod
    async def export(self) -> list[dict]:
        """Export all knowledge items as a JSON-serialisable list."""

    @abstractmethod
    async def import_items(self, items: list[dict]) -> int:
        """Import knowledge items from a list; return the count added."""
