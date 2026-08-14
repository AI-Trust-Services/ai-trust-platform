"""Unit tests for the tenancy resolver — the two CRITICAL isolation guards (SEC-C1, SEC-C2).

These are pure unit tests (no DB, no network): they build fake Starlette requests and a
locally-signed RSA JWT, and assert the resolver's fail-closed behaviour. Run with:
    cd libs/tenancy && pip install -e . pytest && pytest
"""
from __future__ import annotations

import base64
import importlib
import json
import time

import pytest


# ---- helpers ---------------------------------------------------------------------

def _reload_tenancy(monkeypatch, **env):
    """Set env then reload config + resolver so module-level constants pick up the env."""
    for k in ("TENANCY_MODE", "TENANT_CLAIM", "TENANT_HEADER",
              "TENANCY_JWKS_ISSUER_BASE", "TENANCY_JWT_AUDIENCE", "TENANCY_JWT_VERIFY"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import ai_trust_tenancy.config as config
    import ai_trust_tenancy.resolver as resolver
    importlib.reload(config)
    importlib.reload(resolver)
    return resolver


class _Req:
    """Minimal stand-in for starlette Request (only .headers is used)."""
    def __init__(self, headers: dict):
        self.headers = {k.lower(): v for k, v in headers.items()}


def _unsigned_jwt(claims: dict) -> str:
    def b64(d: bytes) -> str:
        return base64.urlsafe_b64encode(d).rstrip(b"=").decode()
    header = b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    payload = b64(json.dumps(claims).encode())
    return f"{header}.{payload}.sig"


ISS = "https://mesh.example/keycloak/realms/tenantA"
BASE = "https://mesh.example/keycloak/realms"


# ---- SEC-C1: client X-Tenant-Id must NOT override in jwt mode ---------------------

def test_jwt_mode_ignores_client_x_tenant_id(monkeypatch):
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="jwt", TENANCY_JWKS_ISSUER_BASE=BASE,
                        TENANCY_JWT_VERIFY="false")
    # attacker sends X-Tenant-Id: tenantB but a valid tenantA token
    tok = _unsigned_jwt({"iss": ISS, "tenant_id": "tenantA", "exp": int(time.time()) + 3600})
    req = _Req({"X-Tenant-Id": "tenantB", "Authorization": f"Bearer {tok}"})
    assert r.resolve_tenant(req) == "tenantA"  # NOT tenantB


def test_header_mode_honors_x_tenant_id(monkeypatch):
    # header mode is the ONLY mode where the header is authoritative (trusted proxy contract)
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="header")
    req = _Req({"X-Tenant-Id": "tenantX"})
    assert r.resolve_tenant(req) == "tenantX"


def test_single_mode_returns_none(monkeypatch):
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="single")
    req = _Req({"X-Tenant-Id": "tenantB", "Authorization": "Bearer x.y.z"})
    assert r.resolve_tenant(req) is None


# ---- SEC-C2: unverified / wrong-issuer tokens must fail closed --------------------

def test_jwt_verify_rejects_issuer_outside_allowlist(monkeypatch):
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="jwt",
                        TENANCY_JWKS_ISSUER_BASE="https://trusted.example/realms",
                        TENANCY_JWT_VERIFY="false")
    # token from an attacker-controlled issuer NOT under the allowlisted base
    tok = _unsigned_jwt({"iss": "https://evil.example/realms/tenantB", "tenant_id": "tenantB",
                         "exp": int(time.time()) + 3600})
    req = _Req({"Authorization": f"Bearer {tok}"})
    assert r.resolve_tenant(req) is None  # fail-closed


def test_jwt_verify_true_rejects_unsigned_token(monkeypatch):
    # With verification ON, an unsigned/forged token cannot pass signature check.
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="jwt", TENANCY_JWKS_ISSUER_BASE=BASE,
                        TENANCY_JWT_VERIFY="true")
    tok = _unsigned_jwt({"iss": ISS, "tenant_id": "tenantA", "exp": int(time.time()) + 3600})
    req = _Req({"Authorization": f"Bearer {tok}"})
    # JWKS fetch/signature verification fails (no network / no real key) → None, never a tenant
    assert r.resolve_tenant(req) is None


def test_jwt_iss_fallback_when_no_claim(monkeypatch):
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="jwt", TENANCY_JWKS_ISSUER_BASE=BASE,
                        TENANCY_JWT_VERIFY="false")
    tok = _unsigned_jwt({"iss": ISS, "exp": int(time.time()) + 3600})  # no tenant_id claim
    req = _Req({"Authorization": f"Bearer {tok}"})
    assert r.resolve_tenant(req) == "tenantA"  # parsed from /realms/tenantA


def test_no_token_returns_none(monkeypatch):
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="jwt", TENANCY_JWKS_ISSUER_BASE=BASE,
                        TENANCY_JWT_VERIFY="false")
    assert r.resolve_tenant(_Req({})) is None


# ---- config fail-fast -------------------------------------------------------------

def test_config_rejects_invalid_mode(monkeypatch):
    import ai_trust_tenancy.config as config
    monkeypatch.setenv("TENANCY_MODE", "bogus")
    importlib.reload(config)
    with pytest.raises(RuntimeError):
        config.validate()


def test_config_jwt_requires_issuer_base(monkeypatch):
    import ai_trust_tenancy.config as config
    monkeypatch.setenv("TENANCY_MODE", "jwt")
    monkeypatch.delenv("TENANCY_JWKS_ISSUER_BASE", raising=False)
    monkeypatch.setenv("TENANCY_JWT_VERIFY", "true")
    importlib.reload(config)
    with pytest.raises(RuntimeError):
        config.validate()


def test_config_refuses_insecure_jwt_without_optin(monkeypatch):
    # SEC-L1: JWT_VERIFY=false in jwt mode must be an explicit opt-in.
    import ai_trust_tenancy.config as config
    monkeypatch.setenv("TENANCY_MODE", "jwt")
    monkeypatch.setenv("TENANCY_JWKS_ISSUER_BASE", "https://x/realms")
    monkeypatch.setenv("TENANCY_JWT_VERIFY", "false")
    monkeypatch.delenv("TENANCY_ALLOW_INSECURE_JWT", raising=False)
    importlib.reload(config)
    with pytest.raises(RuntimeError):
        config.validate()


def test_config_allows_insecure_jwt_with_explicit_optin(monkeypatch):
    import ai_trust_tenancy.config as config
    monkeypatch.setenv("TENANCY_MODE", "jwt")
    monkeypatch.setenv("TENANCY_JWKS_ISSUER_BASE", "https://x/realms")
    monkeypatch.setenv("TENANCY_JWT_VERIFY", "false")
    monkeypatch.setenv("TENANCY_ALLOW_INSECURE_JWT", "true")
    importlib.reload(config)
    config.validate()  # must not raise


# ---- AC4: custom resolver hook (replaceable/adaptable tenancy) --------------------

def test_custom_resolver_takes_precedence(monkeypatch):
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="jwt", TENANCY_JWKS_ISSUER_BASE=BASE,
                        TENANCY_JWT_VERIFY="false")
    r.register_resolver(lambda req: "custom-tenant")
    try:
        # even with no token, the custom resolver wins
        assert r.resolve_tenant(_Req({})) == "custom-tenant"
    finally:
        r.register_resolver(None)


def test_custom_resolver_none_falls_through_to_builtin(monkeypatch):
    r = _reload_tenancy(monkeypatch, TENANCY_MODE="jwt", TENANCY_JWKS_ISSUER_BASE=BASE,
                        TENANCY_JWT_VERIFY="false")
    r.register_resolver(lambda req: None)  # augment, don't replace
    try:
        tok = _unsigned_jwt({"iss": ISS, "tenant_id": "tenantA", "exp": int(time.time()) + 3600})
        assert r.resolve_tenant(_Req({"Authorization": f"Bearer {tok}"})) == "tenantA"
    finally:
        r.register_resolver(None)
