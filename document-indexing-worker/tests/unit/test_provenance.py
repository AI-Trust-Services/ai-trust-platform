"""Unit tests for chunk provenance extraction (no Docling needed — fake chunks).

Verifies we capture BOTH provenance forms: page/bbox (PDF) and structural anchor,
and that the first page is chosen when a chunk spans several.
"""

from ingest import _provenance


class _FakeBBox:
    def __init__(self, l, t, r, b, origin):  # noqa: E741
        self.l = l
        self.t = t
        self.r = r
        self.b = b
        self.coord_origin = type("O", (), {"value": origin})()


class _FakeProv:
    def __init__(self, page_no, bbox):
        self.page_no = page_no
        self.bbox = bbox


class _FakeItem:
    def __init__(self, self_ref, prov):
        self.self_ref = self_ref
        self.prov = prov


class _FakeMeta:
    def __init__(self, doc_items):
        self.doc_items = doc_items


class _FakeChunk:
    def __init__(self, doc_items):
        self.meta = _FakeMeta(doc_items)


def test_pdf_provenance_page_and_bbox():
    bbox = _FakeBBox(1.0, 2.0, 3.0, 4.0, "BOTTOMLEFT")
    chunk = _FakeChunk([_FakeItem("#/texts/5", [_FakeProv(7, bbox)])])
    page, bboxes, self_ref = _provenance(chunk)
    assert page == 7
    assert self_ref == "#/texts/5"
    assert bboxes[0]["page"] == 7
    assert bboxes[0]["origin"] == "BOTTOMLEFT"
    assert bboxes[0]["l"] == 1.0


def test_first_page_when_spanning():
    chunk = _FakeChunk(
        [
            _FakeItem("#/texts/1", [_FakeProv(9, None)]),
            _FakeItem("#/texts/2", [_FakeProv(4, None)]),
        ]
    )
    page, _, self_ref = _provenance(chunk)
    assert page == 4  # min across items
    assert self_ref == "#/texts/1"  # first anchor wins


def test_text_only_anchor_no_page():
    chunk = _FakeChunk([_FakeItem("#/texts/0", [])])
    page, bboxes, self_ref = _provenance(chunk)
    assert page is None
    assert bboxes == []
    assert self_ref == "#/texts/0"
