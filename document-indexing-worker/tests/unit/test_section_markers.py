"""Unit tests for section-marker recovery (no Docling needed — fake document/chunks).

Structured legal texts (the EU AI Act) number sections with a bare "Article N" heading
that Docling keeps as a sibling of the section title, so the chunker drops it. These
tests cover the recovery (``_section_markers``) and the nearest-preceding mapping
(``_marker_for``) that re-attaches the identifier to each chunk's embedding/FTS text.
"""

from ingest import _marker_for, _section_markers


class _FakeTextItem:
    def __init__(self, label, text):
        self.label = label
        self.text = text


class _FakeDoc:
    def __init__(self, texts):
        self.texts = texts


class _FakeDocItem:
    def __init__(self, self_ref):
        self.self_ref = self_ref


class _FakeMeta:
    def __init__(self, doc_items):
        self.doc_items = doc_items


class _FakeChunk:
    def __init__(self, refs):
        self.meta = _FakeMeta([_FakeDocItem(r) for r in refs])


def _doc():
    # texts[1] = "Article  70" (double space, as Docling reads it), texts[4] = "Annex III"
    return _FakeDoc(
        [
            _FakeTextItem("section_header", "National competent authorities"),
            _FakeTextItem("section_header", "Article  70"),
            _FakeTextItem(
                "section_header", "Designation of national competent authorities"
            ),
            _FakeTextItem("list_item", "1. Each Member State shall establish ..."),
            _FakeTextItem("section_header", "Annex III"),
            _FakeTextItem("list_item", "High-risk AI systems ..."),
        ]
    )


def test_section_markers_detects_and_normalises():
    # double space collapsed, case normalised, non-marker headers ignored
    assert _section_markers(_doc()) == [(1, "Article 70"), (4, "Annex III")]


def test_section_markers_ignores_prose_and_plain_headers():
    doc = _FakeDoc(
        [
            _FakeTextItem("text", "Article 5 lays down prohibited practices ..."),
            _FakeTextItem("section_header", "Scope"),
        ]
    )
    assert _section_markers(doc) == []


def test_marker_for_nearest_preceding():
    markers = _section_markers(_doc())
    indices = [i for i, _ in markers]
    assert _marker_for(_FakeChunk(["#/texts/3"]), indices, markers) == "Article 70"
    assert _marker_for(_FakeChunk(["#/texts/5"]), indices, markers) == "Annex III"


def test_marker_for_before_any_marker_is_none():
    markers = _section_markers(_doc())
    indices = [i for i, _ in markers]
    assert _marker_for(_FakeChunk(["#/texts/0"]), indices, markers) is None


def test_marker_for_uses_min_text_index_and_ignores_non_text_refs():
    markers = _section_markers(_doc())
    indices = [i for i, _ in markers]
    chunk = _FakeChunk(["#/tables/9", "#/texts/5", "#/texts/3"])
    assert _marker_for(chunk, indices, markers) == "Article 70"


def test_marker_for_no_markers_returns_none():
    assert _marker_for(_FakeChunk(["#/texts/3"]), [], []) is None
