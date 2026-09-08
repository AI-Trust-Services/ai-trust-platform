"""E2E scenarios for the marketplace backend (ASGITransport + Postgres).

Deploy dispatch and Keycloak provisioners are faked in conftest (`e2e_setup`) — these tests
exercise the router's real DB bookkeeping, gating, and serialization end-to-end. Run:

    cd marketplace/backend && python -m pytest tests/e2e -q     # needs Postgres
"""
from __future__ import annotations

import pytest

from tests.e2e.conftest import create_service, register_discovered

pytestmark = pytest.mark.asyncio


# ── image add: persisted deploy fields ─────────────────────────────────────────────────────────

async def test_image_add_persists_deploy_fields(client):
    row = await create_service(
        client, name="whoami", label="Who Am I", kind="image", app_port=80,
        image_ref="ghcr.io/acme/app:1.2", registry_private=True, git_url="",
    )
    assert row["kind"] == "image"
    assert row["image_ref"] == "ghcr.io/acme/app:1.2"
    assert row["app_port"] == 80
    assert row["registry_private"] is True
    assert row["status"] == "pending"
    # The non-secret flag surfaces; credentials never appear on the response.
    assert "registry_username" not in row
    assert "registry_token" not in row


# ── #5: internal server app honours open_mode=new_tab ──────────────────────────────────────────

async def test_internal_image_honours_new_tab(client):
    row = await create_service(
        client, name="grafana", label="Grafana", kind="image", app_port=3000,
        image_ref="grafana/grafana:latest", open_mode="new_tab", git_url="",
    )
    assert row["open_mode"] == "new_tab"


async def test_internal_static_forced_same_window(client):
    # A static app can never escape the embed — open_mode is coerced to same_window.
    row = await create_service(client, name="site", label="Site", open_mode="new_tab")
    assert row["open_mode"] == "same_window"


async def test_internal_dockerfile_honours_new_tab(client):
    row = await create_service(
        client, name="app", label="App", kind="dockerfile", app_port=8080,
        git_url="https://example.com/app.git", open_mode="new_tab",
    )
    assert row["open_mode"] == "new_tab"


# ── gated SSO app: hidden until enabled ─────────────────────────────────────────────────────────

async def test_sso_app_hidden_until_role_enabled(client, as_user):
    # Operator registers an SSO-gated dockerfile app.
    app_row = await create_service(
        client, name="ssoapp", label="SSO App", kind="dockerfile", app_port=8080,
        git_url="https://example.com/sso.git", sso_enabled=True,
    )
    app_id = app_row["id"]

    # A plain user (no role) does not see the gated app in the catalog.
    headers = as_user.user("bob", roles=[])
    r = await client.get("/v1/services", headers=headers)
    assert r.status_code == 200
    assert all(s["id"] != app_id for s in r.json())

    # Operator enables it for the "auditor" role. Switch the caller posture back to operator
    # first (as_user.user() forced the OpenFGA gate to deny) — enable-role is gated by
    # _require_role_manager → check_permission.
    op_headers = as_user.operator()
    re = await client.post(
        f"/v1/services/{app_id}/enable-role", json={"role": "auditor"}, headers=op_headers,
    )
    assert re.status_code == 200, re.text

    # Now a user holding "auditor" sees it, flagged enabled_for_me.
    headers = as_user.user("carol", roles=["auditor"])
    r = await client.get("/v1/services", headers=headers)
    shown = [s for s in r.json() if s["id"] == app_id]
    assert len(shown) == 1
    assert shown[0]["enabled_for_me"] is True


# ── static app is never retro-hidden (regression) ──────────────────────────────────────────────

async def test_static_app_always_visible(client, as_user):
    static_row = await create_service(client, name="docs", label="Docs")
    headers = as_user.user("dave", roles=[])
    r = await client.get("/v1/services", headers=headers)
    assert any(s["id"] == static_row["id"] for s in r.json())


# ── discovered oidc_federation app: new_tab + operator-only federation creds ────────────────────

async def test_federation_app_sets_new_tab(client):
    row = await register_discovered(
        client, name="fedapp", label="Fed App", auth_mode="oidc_federation",
        oidc_redirect_uri="https://fedapp.example.com/oauth/callback",
    )
    assert row["open_mode"] == "new_tab"
    assert row["auth_mode"] == "oidc_federation"
    assert row["source"] == "external_discovered"
    assert row["status"] == "running"


async def test_federation_setup_operator_only(client, as_user):
    fed = await register_discovered(
        client, name="fed2", label="Fed 2", auth_mode="oidc_federation",
        oidc_redirect_uri="https://fed2.example.com/oauth/callback",
    )
    fed_id = fed["id"]

    # Operator: gets the client credentials block.
    r = await client.get(f"/v1/services/{fed_id}/federation-setup")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["client_id"] == "aitrust-app-fed2"
    assert body["client_secret"] == "test-secret"
    assert body["issuer"].endswith("/realms/ai-trust")

    # Non-operator: _require_role_manager denies (403).
    headers = as_user.user("eve", roles=[])
    r = await client.get(f"/v1/services/{fed_id}/federation-setup", headers=headers)
    assert r.status_code == 403


# ── health_status serialization (#2) ────────────────────────────────────────────────────────────

async def test_health_status_serializes(client):
    row = await register_discovered(
        client, name="probed", label="Probed", health_url="https://probed.example.com/healthz",
    )
    # Fresh row: never probed yet.
    assert row["health_url"] == "https://probed.example.com/healthz"
    assert row["health_status"] is None
    assert row["health_checked_at"] is None

    # Simulate the worker having written an outcome, then confirm it round-trips through the API.
    from sqlalchemy import update
    from ai_trust_persistence.models.marketplace import MarketplaceService
    from tests.e2e.conftest import _test_session_factory
    from datetime import datetime, timezone

    async with _test_session_factory() as session:
        await session.execute(
            update(MarketplaceService)
            .where(MarketplaceService.id == row["id"])
            .values(health_status="up", health_checked_at=datetime.now(timezone.utc))
        )
        await session.commit()

    r = await client.get(f"/v1/services/{row['id']}/status")
    assert r.status_code == 200
    body = r.json()
    assert body["health_status"] == "up"
    assert body["health_checked_at"] is not None


# ── deploy: private image with no creds → 400 (leaves status untouched) ─────────────────────────

async def test_private_image_deploy_without_creds_is_400(client):
    row = await create_service(
        client, name="priv", label="Priv", kind="image", app_port=80,
        image_ref="ghcr.io/acme/priv:1", registry_private=True, git_url="",
    )
    r = await client.post(f"/v1/services/{row['id']}/deploy")
    assert r.status_code == 400
    assert "private" in r.json()["detail"].lower()

    # Status must remain "pending" — the reject happens before flipping to "deploying".
    s = await client.get(f"/v1/services/{row['id']}/status")
    assert s.json()["status"] == "pending"


async def test_public_image_deploy_runs(client):
    row = await create_service(
        client, name="pub", label="Pub", kind="image", app_port=80,
        image_ref="traefik/whoami:latest", git_url="",
    )
    r = await client.post(f"/v1/services/{row['id']}/deploy")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "running"
    assert body["service_host"] == "mkt-pub-svc"


async def test_static_deploy_runs(client):
    row = await create_service(client, name="staticdep", label="Static Dep")
    r = await client.post(f"/v1/services/{row['id']}/deploy")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "running"
    assert body["service_host"] == "mkt-staticdep-svc"


async def test_discovered_app_not_deployable(client):
    row = await register_discovered(client, name="nodep", label="No Deploy")
    r = await client.post(f"/v1/services/{row['id']}/deploy")
    assert r.status_code == 400
    assert "elsewhere" in r.json()["detail"].lower()


# ── OCM ingestion: resolve → register kind=image → deploy ───────────────────────────────────────

async def test_ocm_ingest_registers_image(client, monkeypatch):
    # Mock the CLI-backed resolver: POST /discover/ocm resolves the component to a digest-pinned
    # ref, then persists through the same register path as POST /services (kind="image", pending).
    from app import ocm
    resolved_ref = (
        "ghcr.io/mirceacraciun/mirceacraciun/whether-app:1.0.0"
        "@sha256:818236bc17718e63210fb7faa16d83d3efddea786bf9ac03e1b815209fc2a240"
    )

    async def _fake_resolve(repo, component, resource=None, creds=None):
        return ocm.ResolvedComponent(
            image_ref=resolved_ref, resource_name="whether-app",
            component=component, version="1.0.0",
            digest="818236bc17718e63210fb7faa16d83d3efddea786bf9ac03e1b815209fc2a240",
        )

    monkeypatch.setattr(ocm, "resolve_component", _fake_resolve)

    r = await client.post("/v1/discover/ocm", json={
        "name": "whether-app", "label": "Weather App",
        "ocm_repo": "ghcr.io/mirceacraciun",
        "component": "github.com/mirceacraciun/whether-app:1.0.0",
        "app_port": 3000, "open_mode": "new_tab", "registry_private": True,
    })
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["kind"] == "image"
    assert row["image_ref"] == resolved_ref  # the un-guessable resolved ref, not the component name
    assert row["app_port"] == 3000
    assert row["open_mode"] == "new_tab"
    assert row["registry_private"] is True
    assert row["source"] == "internal"
    assert row["status"] == "pending"

    # The ingested row deploys through the normal image path (deploy is faked in e2e_setup).
    d = await client.post(f"/v1/services/{row['id']}/deploy", json={
        "registry_username": "mirceacraciun", "registry_token": "ghp_fake",
    })
    assert d.status_code == 200, d.text
    assert d.json()["status"] == "running"


async def test_ocm_ingest_resolver_error_surfaces(client, monkeypatch):
    # A resolver HTTPException (e.g. component has no ociImage) propagates as the API status.
    from app import ocm
    from fastapi import HTTPException

    async def _boom(repo, component, resource=None, creds=None):
        raise HTTPException(422, "Component has no ociImage/ociArtifact resource to deploy")

    monkeypatch.setattr(ocm, "resolve_component", _boom)
    r = await client.post("/v1/discover/ocm", json={
        "name": "chartonly", "label": "Chart Only",
        "ocm_repo": "ghcr.io/acme", "component": "github.com/acme/chartonly:1.0.0",
        "app_port": 8080,
    })
    assert r.status_code == 422
    assert "ociImage" in r.json()["detail"]


async def test_ocm_ingest_duplicate_name_409(client, monkeypatch):
    from app import ocm

    async def _fake_resolve(repo, component, resource=None, creds=None):
        return ocm.ResolvedComponent(
            image_ref="ghcr.io/acme/app:1@sha256:abc", resource_name="app",
            component=component, version="1", digest="abc",
        )

    monkeypatch.setattr(ocm, "resolve_component", _fake_resolve)
    body = {"name": "dup", "label": "Dup", "ocm_repo": "ghcr.io/acme",
            "component": "github.com/acme/app:1.0.0", "app_port": 8080}
    r1 = await client.post("/v1/discover/ocm", json=body)
    assert r1.status_code == 201, r1.text
    r2 = await client.post("/v1/discover/ocm", json=body)
    assert r2.status_code == 409


# ── OCM build-from-repo: clone+build+push → resolve → register kind=image → deploy ───────────────

async def test_ocm_build_registers_image(client, monkeypatch):
    # Mock the build orchestrator: POST /discover/ocm/build builds the component from the repo, then
    # persists through the same register path as an image row (kind="image", pending). Because the
    # built image lands in the in-cluster registry, no pull creds are needed at deploy (no
    # registry_private) — deploy is body-less.
    from app import ocm
    built_ref = "registry:5000/whether-app:1.0.0@sha256:aaaa"

    async def _fake_build(git_url, git_ref, registry, component=None, resource=None,
                          constructor="component-constructor.yaml"):
        return ocm.ResolvedComponent(
            image_ref=built_ref, resource_name="whether-app",
            component="github.com/mirceacraciun/whether-app", version="1.0.0", digest="aaaa",
        )

    monkeypatch.setattr(ocm, "build_component", _fake_build)

    r = await client.post("/v1/discover/ocm/build", json={
        "name": "whether-built", "label": "Weather (built)",
        "git_url": "https://github.com/mirceacraciun/whether-app.git", "git_ref": "main",
        "app_port": 3000, "open_mode": "new_tab",
    })
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["kind"] == "image"
    assert row["image_ref"] == built_ref  # the freshly-built, in-cluster digest-pinned ref
    assert row["app_port"] == 3000
    assert row["open_mode"] == "new_tab"
    assert row["registry_private"] is False  # in-cluster registry — no pull creds
    assert row["source"] == "internal"
    assert row["status"] == "pending"

    # Deploys body-less through the normal image path (deploy faked in e2e_setup).
    d = await client.post(f"/v1/services/{row['id']}/deploy")
    assert d.status_code == 200, d.text
    assert d.json()["status"] == "running"


async def test_ocm_build_error_surfaces_422(client, monkeypatch):
    # A build failure (e.g. repo with no component-constructor.yaml) raises DeployError, which the
    # route maps to a clean 422 with no half-created row.
    from app import ocm
    from app.docker_client import DeployError

    async def _boom(git_url, git_ref, registry, component=None, resource=None,
                    constructor="component-constructor.yaml"):
        raise DeployError("Repository has no 'component-constructor.yaml' at its root")

    monkeypatch.setattr(ocm, "build_component", _boom)
    r = await client.post("/v1/discover/ocm/build", json={
        "name": "no-ctor", "label": "No Constructor",
        "git_url": "https://github.com/acme/no-ctor.git", "app_port": 8080,
    })
    assert r.status_code == 422
    assert "component-constructor.yaml" in r.json()["detail"]
    # No half-created row: the name is still free.
    listed = (await client.get("/v1/services")).json()
    assert not any(s["name"] == "no-ctor" for s in listed)


async def test_ocm_build_duplicate_name_409(client, monkeypatch):
    from app import ocm

    async def _fake_build(git_url, git_ref, registry, component=None, resource=None,
                          constructor="component-constructor.yaml"):
        return ocm.ResolvedComponent(
            image_ref="registry:5000/app:1@sha256:bbbb", resource_name="app",
            component="github.com/acme/app", version="1", digest="bbbb",
        )

    monkeypatch.setattr(ocm, "build_component", _fake_build)
    body = {"name": "dupbuilt", "label": "Dup Built",
            "git_url": "https://github.com/acme/app.git", "app_port": 8080}
    r1 = await client.post("/v1/discover/ocm/build", json=body)
    assert r1.status_code == 201, r1.text
    r2 = await client.post("/v1/discover/ocm/build", json=body)
    assert r2.status_code == 409


# ── proxy gate: 403 for unenabled discovered app, then forwards after enable ────────────────────

async def test_proxy_gated_then_forwarded(client, as_user, monkeypatch):
    # Register a bearer discovered app (embeds through the proxy).
    row = await register_discovered(client, name="proxied", label="Proxied", auth_mode="bearer")
    app_id = row["id"]

    # Unenabled user → 403 at the proxy.
    headers = as_user.user("frank", roles=[])
    r = await client.get(f"/v1/proxy/proxied/", headers=headers)
    assert r.status_code == 403

    # Operator enables it for frank's role. Restore operator posture first (the OpenFGA gate was
    # forced to deny by as_user.user()) so _require_role_manager passes on enable-role.
    op_headers = as_user.operator()
    re = await client.post(
        f"/v1/services/{app_id}/enable-role", json={"role": "viewer"}, headers=op_headers,
    )
    assert re.status_code == 200, re.text

    # Now frank (holding "viewer") passes the gate; the upstream call itself fails (no real
    # upstream) → 502, which proves the gate was cleared and forwarding was attempted.
    headers = as_user.user("frank", roles=["viewer"])
    r = await client.get(f"/v1/proxy/proxied/", headers=headers)
    assert r.status_code == 502
