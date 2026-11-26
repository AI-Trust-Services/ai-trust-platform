"""Unit tests for the BYO-LLM endpoint SSRF validator (``validate_endpoint_url``).

Lives in the registry unit suite because that is what CI runs; the function
itself ships in ``libs/persistence`` (``ai_trust_persistence.llm_config``).
Pure function; the only I/O is DNS resolution, exercised with literal IPs
(resolve to themselves) and a known-unresolvable ``.invalid`` host.
"""

from __future__ import annotations

from ai_trust_persistence.llm_config import validate_endpoint_url


def test_https_public_ip_passes():
    assert validate_endpoint_url("https://8.8.8.8/v1") is None


def test_blank_is_rejected():
    assert validate_endpoint_url("") is not None
    assert validate_endpoint_url(None) is not None


def test_non_http_scheme_rejected():
    assert validate_endpoint_url("ftp://example.com/v1") is not None


def test_plain_http_rejected_for_remote_host():
    assert validate_endpoint_url("http://8.8.8.8/v1") is not None


def test_localhost_rejected():
    # No dev carve-out: a BYO provider endpoint is a public service, and
    # localhost resolves to loopback, which is always blocked.
    assert validate_endpoint_url("http://localhost:1234/v1") is not None
    assert validate_endpoint_url("https://localhost:1234/v1") is not None


def test_loopback_ip_rejected():
    assert validate_endpoint_url("https://127.0.0.1/v1") is not None


def test_private_ip_rejected():
    assert validate_endpoint_url("https://10.0.0.5/v1") is not None
    assert validate_endpoint_url("https://192.168.1.10/v1") is not None
    assert validate_endpoint_url("https://172.16.0.1/v1") is not None


def test_cloud_metadata_ip_rejected():
    assert validate_endpoint_url("https://169.254.169.254/v1") is not None


def test_unresolvable_host_passes_ssrf():
    # DNS failure is not an SSRF signal — the connection attempt surfaces it later.
    assert validate_endpoint_url("https://nonexistent-host.invalid/v1") is None
