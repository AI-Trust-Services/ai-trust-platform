"""Unit tests for the test-bed context assembly helper."""

from app.routers.testbed import _format_passages_as_context


def test_format_passages_empty():
    assert _format_passages_as_context([], "EU AI Act") == ""


def test_format_passages_single():
    passages = [
        {
            "passage": "Annex III covers high-risk AI systems.",
            "source": {"filename": "eu_ai_act.pdf", "page": 12, "version_label": "1.0"},
        }
    ]
    result = _format_passages_as_context(passages, "EU AI Act")
    assert "EU AI Act" in result
    assert "Annex III covers high-risk AI systems." in result
    assert "eu_ai_act.pdf" in result
    assert "p. 12" in result


def test_format_passages_multiple():
    passages = [
        {
            "passage": "First passage.",
            "source": {"filename": "doc.pdf", "page": None, "version_label": "1.0"},
        },
        {
            "passage": "Second passage.",
            "source": {"filename": "doc.pdf", "page": 5, "version_label": "1.0"},
        },
    ]
    result = _format_passages_as_context(passages, "System docs")
    assert "[1]" in result
    assert "[2]" in result
    assert "p. 5" in result
    assert "First passage." in result
    assert "Second passage." in result


def test_format_passages_no_page():
    passages = [
        {
            "passage": "No page.",
            "source": {"filename": "readme.md", "page": None, "version_label": "2.0"},
        }
    ]
    result = _format_passages_as_context(passages, "Docs")
    assert "readme.md" in result
    assert "p." not in result
