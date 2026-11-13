"""Unit tests for the public-presign scheme selection (`_public_secure`).

Regression guard for the "advisor source link opens a blank tab" bug: the
browser-facing MinIO endpoint is served over HTTPS through the Gardener ingress,
but the in-cluster client talks plain HTTP to ``minio:9000`` (``MINIO_SECURE``
is ``false`` everywhere). Presigning the public URL with ``secure=false`` emits
an ``http://`` URL the HTTPS-only ingress can't serve, so the opened tab stays
blank. ``MINIO_PUBLIC_SECURE`` lets the public scheme be set independently;
it falls back to ``MINIO_SECURE`` so kind/local is unaffected.
"""

from __future__ import annotations

import pytest

from app.minio_client import _public_secure


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("MINIO_PUBLIC_SECURE", raising=False)
    monkeypatch.delenv("MINIO_SECURE", raising=False)
    yield


def test_defaults_to_minio_secure_when_public_unset(monkeypatch):
    # Local/kind: only MINIO_SECURE is set (false) → public presign is http.
    monkeypatch.setenv("MINIO_SECURE", "false")
    assert _public_secure() is False


def test_public_secure_true_overrides_false_minio_secure(monkeypatch):
    # Gardener: in-cluster client stays http (minio:9000) but presigned
    # browser URLs must be https (TLS ingress).
    monkeypatch.setenv("MINIO_SECURE", "false")
    monkeypatch.setenv("MINIO_PUBLIC_SECURE", "true")
    assert _public_secure() is True


def test_public_secure_false_overrides_true_minio_secure(monkeypatch):
    monkeypatch.setenv("MINIO_SECURE", "true")
    monkeypatch.setenv("MINIO_PUBLIC_SECURE", "false")
    assert _public_secure() is False


def test_case_insensitive(monkeypatch):
    monkeypatch.setenv("MINIO_SECURE", "false")
    monkeypatch.setenv("MINIO_PUBLIC_SECURE", "TRUE")
    assert _public_secure() is True
