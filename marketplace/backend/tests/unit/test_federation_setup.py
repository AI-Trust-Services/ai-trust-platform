"""Unit tests for the oidc_federation "Federation setup" block assembly. No DB, no network.

Covers `_federation_setup` (the pure endpoint helper that turns an app row + a live client secret
into the copy-paste OIDC values): endpoints derive from KEYCLOAK_PUBLIC_URL (the browser-facing
issuer, never the in-cluster KEYCLOAK_URL), the realm is honoured, a trailing slash is tolerated,
the redirect_uri is passed through, and a missing KEYCLOAK_PUBLIC_URL is a hard 500.

Importing the router pulls in DB/auth modules, so those env vars are stubbed before import.

Run: cd marketplace/backend && python -m pytest tests/unit -q
"""
import os
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # marketplace/backend on sys.path

# Keycloak module reads these at import time; stub before importing the router.
os.environ.setdefault("KEYCLOAK_URL", "http://keycloak:8080")
os.environ.setdefault("KEYCLOAK_ADMIN", "admin")
os.environ.setdefault("KEYCLOAK_ADMIN_PASSWORD", "admin-secret")

from fastapi import HTTPException  # noqa: E402

from app.routers import services  # noqa: E402


def _row(**kw):
    row = types.SimpleNamespace(
        name="weather", oidc_client_id=None, oidc_redirect_uri=None, auth_mode="oidc_federation"
    )
    for k, v in kw.items():
        setattr(row, k, v)
    return row


def test_setup_derives_endpoints_from_public_url(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_PUBLIC_URL", "https://auth.example.com")
    monkeypatch.setattr(services.keycloak, "REALM", "ai-trust")
    row = _row(oidc_client_id="aitrust-app-weather",
               oidc_redirect_uri="https://app.example.com/callback")

    out = services._federation_setup(row, "S3CRET")

    assert out.issuer == "https://auth.example.com/realms/ai-trust"
    assert out.discovery_url == (
        "https://auth.example.com/realms/ai-trust/.well-known/openid-configuration"
    )
    oidc = "https://auth.example.com/realms/ai-trust/protocol/openid-connect"
    assert out.authorization_endpoint == f"{oidc}/auth"
    assert out.token_endpoint == f"{oidc}/token"
    assert out.userinfo_endpoint == f"{oidc}/userinfo"
    assert out.jwks_uri == f"{oidc}/certs"
    assert out.client_id == "aitrust-app-weather"
    assert out.client_secret == "S3CRET"
    assert out.scopes == ["openid", "profile", "email"]
    assert out.redirect_uri == "https://app.example.com/callback"


def test_setup_never_uses_internal_keycloak_url(monkeypatch):
    # The in-cluster KEYCLOAK_URL must never leak into the emitted issuer/endpoints.
    monkeypatch.setenv("KEYCLOAK_URL", "http://keycloak:8080")
    monkeypatch.setenv("KEYCLOAK_PUBLIC_URL", "https://auth.example.com")
    monkeypatch.setattr(services.keycloak, "REALM", "ai-trust")

    out = services._federation_setup(_row(oidc_client_id="aitrust-app-weather"), "x")

    for value in (out.issuer, out.discovery_url, out.authorization_endpoint,
                  out.token_endpoint, out.userinfo_endpoint, out.jwks_uri):
        assert "keycloak:8080" not in value
        assert value.startswith("https://auth.example.com/")


def test_setup_tolerates_trailing_slash_and_custom_realm(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_PUBLIC_URL", "https://auth.example.com/")
    monkeypatch.setattr(services.keycloak, "REALM", "custom-realm")

    out = services._federation_setup(_row(oidc_client_id="aitrust-app-weather"), "x")

    assert out.issuer == "https://auth.example.com/realms/custom-realm"
    assert "//realms" not in out.issuer  # no double slash from the trailing "/"


def test_setup_falls_back_to_derived_client_id(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_PUBLIC_URL", "https://auth.example.com")
    monkeypatch.setattr(services.keycloak, "REALM", "ai-trust")

    out = services._federation_setup(_row(oidc_client_id=None, name="weather"), "x")

    assert out.client_id == "aitrust-app-weather"


def test_setup_500_when_public_url_missing(monkeypatch):
    monkeypatch.delenv("KEYCLOAK_PUBLIC_URL", raising=False)
    with pytest.raises(HTTPException) as exc:
        services._federation_setup(_row(oidc_client_id="aitrust-app-weather"), "x")
    assert exc.value.status_code == 500


# ── enable-hook dispatch (_ensure_client_on_enable) ────────────────────────────────────────────────
# Async but plugin-free: driven with asyncio.run so no pytest-asyncio dependency is needed.
import asyncio  # noqa: E402


def test_enable_hook_bearer_mints_app_client(monkeypatch):
    calls = {}

    def _app(name, url):
        calls["app"] = (name, url)
        return "aitrust-app-weather"

    monkeypatch.setattr(services.keycloak, "ensure_app_client", _app)
    monkeypatch.setattr(services.keycloak, "ensure_federation_client",
                        lambda *a: pytest.fail("federation client must not be minted for bearer"))
    row = _row(auth_mode="bearer", external_url="https://app.example.com")
    asyncio.run(services._ensure_client_on_enable(row))
    assert calls["app"] == ("weather", "https://app.example.com")
    assert row.oidc_client_id == "aitrust-app-weather"


def test_enable_hook_federation_mints_federation_client(monkeypatch):
    calls = {}

    def _fed(name, redirect, url):
        calls["fed"] = (name, redirect, url)
        return "aitrust-app-weather"

    monkeypatch.setattr(services.keycloak, "ensure_app_client",
                        lambda *a: pytest.fail("app client must not be minted for oidc_federation"))
    monkeypatch.setattr(services.keycloak, "ensure_federation_client", _fed)
    row = _row(auth_mode="oidc_federation", external_url="https://app.example.com",
               oidc_redirect_uri="https://app.example.com/callback")
    asyncio.run(services._ensure_client_on_enable(row))
    assert calls["fed"] == ("weather", "https://app.example.com/callback", "https://app.example.com")
    assert row.oidc_client_id == "aitrust-app-weather"


def test_enable_hook_noop_for_header_map_and_none(monkeypatch):
    monkeypatch.setattr(services.keycloak, "ensure_app_client",
                        lambda *a: pytest.fail("no client for header_map/none"))
    monkeypatch.setattr(services.keycloak, "ensure_federation_client",
                        lambda *a: pytest.fail("no client for header_map/none"))
    for mode in ("header_map", "none"):
        row = _row(auth_mode=mode, external_url="https://app.example.com")
        asyncio.run(services._ensure_client_on_enable(row))
        assert row.oidc_client_id is None


def test_enable_hook_idempotent_when_client_already_set(monkeypatch):
    monkeypatch.setattr(services.keycloak, "ensure_federation_client",
                        lambda *a: pytest.fail("must not re-mint once oidc_client_id is set"))
    row = _row(auth_mode="oidc_federation", external_url="https://app.example.com",
               oidc_client_id="aitrust-app-weather")
    asyncio.run(services._ensure_client_on_enable(row))
    assert row.oidc_client_id == "aitrust-app-weather"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
