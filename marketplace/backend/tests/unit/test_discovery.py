"""Unit tests for the SSRF guards on the manifest fetcher. No real network egress."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app import discovery  # noqa: E402


@pytest.mark.parametrize("url", [
    "ftp://example.com/manifest.json",
    "file:///etc/passwd",
    "gopher://example.com/",
])
@pytest.mark.asyncio
async def test_rejects_non_http_schemes(url):
    with pytest.raises(HTTPException) as e:
        await discovery.fetch_manifest(url)
    assert e.value.status_code == 400


def test_reject_if_unsafe_blocks_loopback(monkeypatch):
    monkeypatch.setattr(discovery.socket, "getaddrinfo",
                        lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 0))])
    with pytest.raises(HTTPException) as e:
        discovery._reject_if_unsafe("localhost.evil.test")
    assert e.value.status_code == 400


def test_reject_if_unsafe_blocks_metadata_ip(monkeypatch):
    monkeypatch.setattr(discovery.socket, "getaddrinfo",
                        lambda *a, **k: [(2, 1, 6, "", ("169.254.169.254", 0))])
    with pytest.raises(HTTPException):
        discovery._reject_if_unsafe("metadata.evil.test")


def test_reject_if_unsafe_blocks_private(monkeypatch):
    monkeypatch.delenv("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", raising=False)  # default = block
    monkeypatch.setattr(discovery.socket, "getaddrinfo",
                        lambda *a, **k: [(2, 1, 6, "", ("10.0.0.5", 0))])
    with pytest.raises(HTTPException):
        discovery._reject_if_unsafe("internal.evil.test")


def test_private_allowed_when_flag_set(monkeypatch):
    monkeypatch.setenv("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", "true")
    monkeypatch.setattr(discovery.socket, "getaddrinfo",
                        lambda *a, **k: [(2, 1, 6, "", ("10.0.0.5", 0))])
    discovery._reject_if_unsafe("internal.corp")  # should not raise


def test_metadata_ip_blocked_even_with_flag(monkeypatch):
    monkeypatch.setenv("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", "true")
    monkeypatch.setattr(discovery.socket, "getaddrinfo",
                        lambda *a, **k: [(2, 1, 6, "", ("169.254.169.254", 0))])
    with pytest.raises(HTTPException):
        discovery._reject_if_unsafe("metadata.evil.test")


def test_reject_if_unsafe_allows_public(monkeypatch):
    monkeypatch.setattr(discovery.socket, "getaddrinfo",
                        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
    # Should not raise for a public unicast address.
    discovery._reject_if_unsafe("example.com")


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
