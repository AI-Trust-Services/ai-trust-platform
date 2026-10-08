"""Unit tests for version-label auto-increment (the pure part of upload-version)."""

from types import SimpleNamespace

from app.routers.documents import _next_version_label


def _v(label):
    return SimpleNamespace(version_label=label)


def test_first_version_defaults_to_one():
    assert _next_version_label([]) == "1.0"


def test_increments_major_from_existing():
    assert _next_version_label([_v("1.0")]) == "2.0"
    assert _next_version_label([_v("1.0"), _v("2.0")]) == "3.0"


def test_uses_max_major_not_count():
    # Out-of-order / gaps: next is max(major)+1, not len+1.
    assert _next_version_label([_v("3.0"), _v("1.0")]) == "4.0"


def test_ignores_unparseable_labels():
    assert _next_version_label([_v("draft"), _v("2.0")]) == "3.0"
    assert _next_version_label([_v("draft")]) == "1.0"
