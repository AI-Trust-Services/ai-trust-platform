"""Unit tests for hard-delete orchestration (`_purge_document`), no real DB.

The document row is deleted (its ON DELETE CASCADE FKs drop versions + chunks); the
helper returns every version's MinIO key so the caller can purge the originals.
"""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.documents import _purge_document


class _Result:
    def __init__(self, *, scalar=None, scalars=None):
        self._scalar = scalar
        self._scalars = scalars or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return SimpleNamespace(all=lambda: self._scalars)


class _FakeSession:
    """Returns queued results for successive execute() calls; records deletes."""

    def __init__(self, results):
        self._results = list(results)
        self.deleted = []

    async def execute(self, _stmt):
        return self._results.pop(0)

    async def delete(self, obj):
        self.deleted.append(obj)


def test_purge_returns_keys_and_deletes_doc():
    doc = SimpleNamespace(id="DOC-1")
    session = _FakeSession(
        [
            _Result(scalar=doc),  # the Document lookup
            _Result(scalars=["docs/a.pdf", "docs/b.pdf"]),  # version minio_keys
        ]
    )
    keys = asyncio.run(_purge_document(session, "DOC-1"))
    assert keys == ["docs/a.pdf", "docs/b.pdf"]
    assert session.deleted == [doc]


def test_purge_missing_document_raises_404():
    session = _FakeSession([_Result(scalar=None)])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_purge_document(session, "DOC-missing"))
    assert exc.value.status_code == 404
    assert session.deleted == []
