"""Unit tests for the marketplace identity/anti-spoof helper. No DB, no network.

Run: cd marketplace/backend && python -m pytest tests/unit -q
(needs fastapi + the app package importable; identity.py only depends on fastapi.)
"""
import sys
import types
from pathlib import Path

import pytest
from starlette.datastructures import Headers
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # marketplace/backend on sys.path

from app import identity  # noqa: E402


def _request(headers: dict) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope = {"type": "http", "method": "GET", "path": "/", "headers": raw, "query_string": b""}
    return Request(scope)


def _row(**kw):
    row = types.SimpleNamespace(
        auth_mode="bearer", auth_header_name=None, auth_value_template=None
    )
    for k, v in kw.items():
        setattr(row, k, v)
    return row


def test_bearer_forwards_platform_jwt():
    req = _request({
        "authorization": "Bearer PLATFORM_JWT",
        "x-forwarded-preferred-username": "alice",
    })
    out = identity.build_upstream_headers(_row(auth_mode="bearer"), req)
    assert out["Authorization"] == "Bearer PLATFORM_JWT"


def test_header_map_renders_template_and_strips_spoof():
    # Client tries to spoof both X-Remote-User and X-Forwarded-Preferred-Username.
    req = _request({
        "x-remote-user": "admin",  # spoof attempt
        "x-forwarded-preferred-username": "alice",  # set by oauth2-proxy (trusted)
    })
    row = _row(auth_mode="header_map", auth_header_name="X-Remote-User",
               auth_value_template="{preferred_username}")
    out = identity.build_upstream_headers(row, req)
    # Only the injected value survives; the client's spoofed value is gone.
    assert out["X-Remote-User"] == "alice"
    # No duplicate/leftover header under a different case.
    assert sum(1 for k in out if k.lower() == "x-remote-user") == 1


def test_all_inbound_identity_headers_stripped():
    req = _request({
        "authorization": "Bearer CLIENT_FORGED",
        "x-forwarded-user": "attacker-sub",
        "x-forwarded-email": "attacker@evil.test",
        "x-forwarded-preferred-username": "alice",
        "x-custom": "keep-me",
    })
    out = identity.build_upstream_headers(_row(auth_mode="none"), req)
    lowered = {k.lower() for k in out}
    assert "authorization" not in lowered
    assert not any(k.startswith("x-forwarded-") for k in lowered)
    assert out.get("x-custom") == "keep-me"  # non-identity headers pass through


def test_none_mode_injects_nothing():
    req = _request({"authorization": "Bearer X", "x-forwarded-preferred-username": "alice"})
    out = identity.build_upstream_headers(_row(auth_mode="none"), req)
    assert "Authorization" not in out


def test_oidc_federation_injects_nothing_but_strips_identity():
    # oidc_federation behaves like none at the header layer: the app runs its OWN login (new tab),
    # so the proxy must inject nothing — while still stripping every inbound identity header.
    req = _request({
        "authorization": "Bearer CLIENT_FORGED",
        "x-forwarded-preferred-username": "alice",
        "x-forwarded-user": "attacker-sub",
        "x-custom": "keep-me",
    })
    out = identity.build_upstream_headers(_row(auth_mode="oidc_federation"), req)
    lowered = {k.lower() for k in out}
    assert "authorization" not in lowered
    assert not any(k.startswith("x-forwarded-") for k in lowered)
    assert out.get("x-custom") == "keep-me"


def test_bearer_without_jwt_sets_no_auth_header():
    req = _request({"x-forwarded-preferred-username": "alice"})
    out = identity.build_upstream_headers(_row(auth_mode="bearer"), req)
    assert "Authorization" not in out


def test_header_map_unknown_template_field_falls_back():
    req = _request({"x-forwarded-preferred-username": "alice"})
    row = _row(auth_mode="header_map", auth_header_name="X-Remote-User",
               auth_value_template="{does_not_exist}")
    out = identity.build_upstream_headers(row, req)
    assert out["X-Remote-User"] == "alice"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
