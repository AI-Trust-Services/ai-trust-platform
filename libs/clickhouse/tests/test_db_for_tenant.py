"""Unit tests for db_for_tenant fail-closed behaviour (no live ClickHouse needed).

These pin the security-critical rule: an unresolved tenant must NEVER silently fall back to a
shared database in a multi-tenant mode. The mode is read via _tenancy_mode(), which uses the
TENANCY_MODE env var when libs/tenancy is not importable — which is exactly the case here, so
these tests drive the fallback path deterministically.
"""
import importlib

import pytest

from ai_trust_clickhouse import database as db


def _mode(monkeypatch, mode: str | None):
    if mode is None:
        monkeypatch.delenv("TENANCY_MODE", raising=False)
    else:
        monkeypatch.setenv("TENANCY_MODE", mode)


def test_tenant_maps_to_own_database(monkeypatch):
    _mode(monkeypatch, "jwt")
    assert db.db_for_tenant("acme") == "tenant_acme"
    # hyphens are normalised to underscores so the CH db name mirrors the PG schema
    assert db.db_for_tenant("acme-eu") == "tenant_acme_eu"


def test_single_mode_no_tenant_uses_shared_otel(monkeypatch):
    _mode(monkeypatch, "single")
    assert db.db_for_tenant(None) == "otel"
    assert db.db_for_tenant("") == "otel"


def test_default_mode_is_single(monkeypatch):
    # No TENANCY_MODE set (and libs/tenancy absent) → single → otel, never a raise.
    _mode(monkeypatch, None)
    assert db.db_for_tenant(None) == "otel"


@pytest.mark.parametrize("mode", ["jwt", "header"])
def test_multitenant_no_tenant_is_fail_closed(monkeypatch, mode):
    _mode(monkeypatch, mode)
    with pytest.raises(RuntimeError):
        db.db_for_tenant(None)
    with pytest.raises(RuntimeError):
        db.db_for_tenant("")


def test_unsafe_tenant_name_rejected(monkeypatch):
    _mode(monkeypatch, "jwt")
    with pytest.raises(ValueError):
        db.db_for_tenant("bad;name")
    with pytest.raises(ValueError):
        db.db_for_tenant("robert'); DROP")
