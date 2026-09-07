"""Unit tests for the server-app deploy paths (kind="dockerfile" build+run and kind="image"
pull+run). No DB, no network, no Docker.

Covers the pure pieces:
  - app.oidc: issuer / embed_base / redirect_uri / oidc_env — the Platform-SSO env assembly, and the
    hard-500 when APP_PUBLIC_URL / KEYCLOAK_PUBLIC_URL are unset. The client secret is NEVER emitted.
  - services._is_gated: which rows are OpenFGA role-gated (external_discovered + sso dockerfile/image),
    and that static internal apps are NEVER retro-hidden.
  - services._upstream_port: the port the proxy dials (k8s always 80; docker dockerfile/image →
    app_port).
  - docker_client.image_ref / build_k8s.image_ref: the pinned-git_ref image tag (with '/'→'-').
  - schemas.ServiceCreate: kind="image" requires image_ref+app_port, allows sso + blank git_url;
    static still forbids sso; dockerfile still requires git_url; registry_private is image-only.
  - schemas.DeployRequest / ServiceResponse: deploy-time pull creds live on DeployRequest (both
    optional); ServiceResponse carries only the non-secret registry_private flag, never the creds.
  - build_k8s._registry_host / _build_deployment / pull_secret_name: dockerconfigjson host derivation
    and the imagePullSecrets PodSpec wiring (present only when a pull-secret name is passed).
  - docker_client.run_image: passes auth_config to the pull when registry_auth is set, else a bare pull.

Importing the router/keycloak pulls in env-reading modules, so those are stubbed before import.

Run: cd marketplace/backend && python -m pytest tests/unit -q
"""
import importlib
import os
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # marketplace/backend on sys.path

# Keycloak module reads these at import time; stub before importing anything that imports it.
os.environ.setdefault("KEYCLOAK_URL", "http://keycloak:8080")
os.environ.setdefault("KEYCLOAK_ADMIN", "admin")
os.environ.setdefault("KEYCLOAK_ADMIN_PASSWORD", "admin-secret")

from fastapi import HTTPException  # noqa: E402

from app import oidc  # noqa: E402
from app.routers import services  # noqa: E402


def _row(**kw):
    """A minimal MarketplaceService stand-in (SimpleNamespace) with sensible defaults."""
    row = types.SimpleNamespace(
        name="weather", kind="static", source="internal",
        sso_enabled=False, app_port=None, service_host="mkt-weather-svc",
    )
    for k, v in kw.items():
        setattr(row, k, v)
    return row


# ── oidc env assembly ────────────────────────────────────────────────────────────────────────────

def test_issuer_from_public_url(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_PUBLIC_URL", "https://auth.example.com/")  # trailing slash tolerated
    monkeypatch.setattr(oidc.keycloak, "REALM", "ai-trust")
    assert oidc.issuer() == "https://auth.example.com/realms/ai-trust"


def test_issuer_honours_realm(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_PUBLIC_URL", "https://auth.example.com")
    monkeypatch.setattr(oidc.keycloak, "REALM", "tenant-acme")
    assert oidc.issuer() == "https://auth.example.com/realms/tenant-acme"


def test_issuer_missing_public_url_is_500(monkeypatch):
    monkeypatch.delenv("KEYCLOAK_PUBLIC_URL", raising=False)
    with pytest.raises(HTTPException) as exc:
        oidc.issuer()
    assert exc.value.status_code == 500


def test_embed_base_and_redirect_uri(monkeypatch):
    monkeypatch.setenv("APP_PUBLIC_URL", "https://platform.example.com/")  # trailing slash tolerated
    assert oidc.embed_base("weather") == (
        "https://platform.example.com/api/marketplace/v1/proxy/weather"
    )
    assert oidc.redirect_uri("weather") == (
        "https://platform.example.com/api/marketplace/v1/proxy/weather/oauth/callback"
    )


def test_embed_base_missing_app_url_is_500(monkeypatch):
    monkeypatch.delenv("APP_PUBLIC_URL", raising=False)
    with pytest.raises(HTTPException) as exc:
        oidc.embed_base("weather")
    assert exc.value.status_code == 500


def test_oidc_env_shape_and_no_secret(monkeypatch):
    monkeypatch.setenv("APP_PUBLIC_URL", "https://platform.example.com")
    monkeypatch.setenv("KEYCLOAK_PUBLIC_URL", "https://auth.example.com")
    monkeypatch.setattr(oidc.keycloak, "REALM", "ai-trust")

    env = oidc.oidc_env("aitrust-app-weather", "weather")

    assert env == {
        "OIDC_ISSUER": "https://auth.example.com/realms/ai-trust",
        "OIDC_CLIENT_ID": "aitrust-app-weather",
        "OIDC_REDIRECT_URI": (
            "https://platform.example.com/api/marketplace/v1/proxy/weather/oauth/callback"
        ),
        "OIDC_SCOPES": "openid profile email",
    }
    # The secret is delivered separately (k8s Secret / compose env) — never assembled here.
    assert not any("SECRET" in k for k in env)


# ── role-gate predicate ──────────────────────────────────────────────────────────────────────────

def test_is_gated_external_discovered():
    assert services._is_gated(_row(source="external_discovered", kind="static")) is True


def test_is_gated_sso_dockerfile():
    assert services._is_gated(_row(kind="dockerfile", sso_enabled=True)) is True


def test_is_gated_sso_image():
    assert services._is_gated(_row(kind="image", sso_enabled=True)) is True


def test_not_gated_image_without_sso():
    assert services._is_gated(_row(kind="image", sso_enabled=False)) is False


def test_not_gated_static_internal():
    # Regression guard: an existing static internal app must NEVER be retro-hidden.
    assert services._is_gated(_row(kind="static", source="internal")) is False


def test_not_gated_dockerfile_without_sso():
    assert services._is_gated(_row(kind="dockerfile", sso_enabled=False)) is False


def test_not_gated_external():
    assert services._is_gated(_row(source="external", kind="static")) is False


# ── proxy upstream port ──────────────────────────────────────────────────────────────────────────

def test_upstream_port_k8s_always_80(monkeypatch):
    monkeypatch.setattr(services, "_DEPLOY_TARGET", "kubernetes")
    # Even a dockerfile app on k8s is reached on :80 (the Service maps :80 → targetPort).
    assert services._upstream_port(_row(kind="dockerfile", app_port=8501)) == 80


def test_upstream_port_docker_dockerfile_uses_app_port(monkeypatch):
    monkeypatch.setattr(services, "_DEPLOY_TARGET", "docker")
    assert services._upstream_port(_row(kind="dockerfile", app_port=8501)) == 8501


def test_upstream_port_docker_image_uses_app_port(monkeypatch):
    monkeypatch.setattr(services, "_DEPLOY_TARGET", "docker")
    assert services._upstream_port(_row(kind="image", app_port=9000)) == 9000


def test_upstream_port_k8s_image_always_80(monkeypatch):
    monkeypatch.setattr(services, "_DEPLOY_TARGET", "kubernetes")
    assert services._upstream_port(_row(kind="image", app_port=9000)) == 80


def test_upstream_port_docker_static_is_80(monkeypatch):
    monkeypatch.setattr(services, "_DEPLOY_TARGET", "docker")
    assert services._upstream_port(_row(kind="static", app_port=None)) == 80


# ── image ref pinning ────────────────────────────────────────────────────────────────────────────

def test_docker_image_ref_pins_git_ref(monkeypatch):
    from app import docker_client
    monkeypatch.setattr(docker_client, "REGISTRY", "localhost:5000")
    assert docker_client.image_ref("weather", "v1.2.3") == "localhost:5000/mkt-weather:v1.2.3"


def test_image_ref_flattens_slash_in_ref(monkeypatch):
    from app import docker_client
    monkeypatch.setattr(docker_client, "REGISTRY", "localhost:5000")
    # A git ref like "feature/x" is not a legal docker tag — '/' must be flattened to '-'.
    assert docker_client.image_ref("weather", "feature/x") == "localhost:5000/mkt-weather:feature-x"


# ── ServiceCreate validators (kind="image") ───────────────────────────────────────────────────────

def test_image_kind_requires_image_ref():
    from pydantic import ValidationError
    from app.schemas import ServiceCreate
    with pytest.raises(ValidationError):
        ServiceCreate(name="whoami", label="Who Am I", kind="image", app_port=80)


def test_image_kind_requires_app_port():
    from pydantic import ValidationError
    from app.schemas import ServiceCreate
    with pytest.raises(ValidationError):
        ServiceCreate(name="whoami", label="Who Am I", kind="image",
                      image_ref="traefik/whoami:latest")


def test_image_ref_rejects_whitespace():
    from pydantic import ValidationError
    from app.schemas import ServiceCreate
    with pytest.raises(ValidationError):
        ServiceCreate(name="whoami", label="Who Am I", kind="image", app_port=80,
                      image_ref="traefik/whoami :latest")


def test_image_kind_allows_sso_and_no_git_url():
    from app.schemas import ServiceCreate
    m = ServiceCreate(name="whoami", label="Who Am I", kind="image", app_port=80,
                      image_ref="traefik/whoami:latest", sso_enabled=True)
    assert m.kind == "image"
    assert m.image_ref == "traefik/whoami:latest"
    assert m.sso_enabled is True
    assert m.git_url == ""  # no repo needed for an image app


def test_static_still_forbids_sso():
    from pydantic import ValidationError
    from app.schemas import ServiceCreate
    with pytest.raises(ValidationError):
        ServiceCreate(name="site", label="Site", kind="static",
                      git_url="https://x/y.git", sso_enabled=True)


def test_dockerfile_still_requires_git_url():
    from pydantic import ValidationError
    from app.schemas import ServiceCreate
    with pytest.raises(ValidationError):
        ServiceCreate(name="app", label="App", kind="dockerfile", app_port=8080)


# ── private-registry image pulls (registry_private) ────────────────────────────────────────────────

def test_image_allows_registry_private():
    from app.schemas import ServiceCreate
    m = ServiceCreate(name="whoami", label="Who Am I", kind="image", app_port=80,
                      image_ref="ghcr.io/acme/app:1.2", registry_private=True)
    assert m.registry_private is True


def test_registry_private_rejected_for_non_image():
    from pydantic import ValidationError
    from app.schemas import ServiceCreate
    # A static/dockerfile app cannot be registry_private — the flag is image-only.
    with pytest.raises(ValidationError):
        ServiceCreate(name="site", label="Site", kind="static",
                      git_url="https://x/y.git", registry_private=True)


def test_service_response_carries_flag_not_creds():
    from app.schemas import ServiceResponse
    # ServiceResponse exposes the non-secret boolean and has NO credential fields.
    assert "registry_private" in ServiceResponse.model_fields
    assert "registry_username" not in ServiceResponse.model_fields
    assert "registry_token" not in ServiceResponse.model_fields


def test_deploy_request_shape():
    from app.schemas import DeployRequest
    # Both optional (public / non-private redeploy sends no body).
    assert DeployRequest().registry_username is None
    m = DeployRequest(registry_username="u", registry_token="t")
    assert (m.registry_username, m.registry_token) == ("u", "t")


# ── build_k8s: registry-host derivation + pull-secret PodSpec wiring ────────────────────────────────

def test_registry_host_derivation():
    from app import build_k8s
    assert build_k8s._registry_host("ghcr.io/acme/app:1.2") == "ghcr.io"
    assert build_k8s._registry_host("registry.example.com:5000/x/y:z") == "registry.example.com:5000"
    assert build_k8s._registry_host("localhost:5000/mkt-x:main") == "localhost:5000"
    # A bare Docker Hub ref (no registry host) → the v1 index URL Docker expects for auth.
    assert build_k8s._registry_host("acme/app:1.2") == "https://index.docker.io/v1/"


def test_build_deployment_pull_secret_only_when_named():
    from app import build_k8s
    # No pull secret → PodSpec.image_pull_secrets is None (byte-identical to public/dockerfile).
    dep = build_k8s._build_deployment("whoami", "traefik/whoami:latest", 80, [])
    assert dep.spec.template.spec.image_pull_secrets is None
    # Named pull secret → referenced on the PodSpec.
    dep2 = build_k8s._build_deployment(
        "whoami", "ghcr.io/acme/app:1.2", 80, [], image_pull_secret="mkt-whoami-pull"
    )
    refs = dep2.spec.template.spec.image_pull_secrets
    assert [r.name for r in refs] == ["mkt-whoami-pull"]


def test_pull_secret_name():
    from app import build_k8s
    assert build_k8s.pull_secret_name("whoami") == "mkt-whoami-pull"


def test_docker_run_image_passes_auth_config(monkeypatch):
    """docker_client.run_image threads registry_auth into the pull as auth_config, else omits it."""
    from app import docker_client

    calls: list[dict] = []

    class _FakeImages:
        def pull(self, ref, **kw):
            calls.append({"ref": ref, **kw})

    class _FakeContainers:
        def get(self, _):
            raise docker_client.docker.errors.NotFound("nope")

        def run(self, *a, **kw):
            pass

    class _FakeCli:
        images = _FakeImages()
        containers = _FakeContainers()

    monkeypatch.setattr(docker_client, "_client", lambda: _FakeCli())
    monkeypatch.setattr(docker_client, "_detect_network", lambda _cli: None)

    auth = {"username": "u", "password": "t"}
    docker_client.run_image("whoami", "ghcr.io/acme/app:1.2", 80, {}, {}, registry_auth=auth)
    assert calls[-1] == {"ref": "ghcr.io/acme/app:1.2", "auth_config": auth}

    calls.clear()
    docker_client.run_image("whoami", "traefik/whoami:latest", 80, {}, {})
    # No auth_config key at all when public (bare pull).
    assert calls[-1] == {"ref": "traefik/whoami:latest"}


# ── gitauth.credentials_for: host-match → GIT_ASKPASS creds, never a URL-embedded token (#4) ───────

def test_credentials_for_matching_host(monkeypatch):
    from app import gitauth
    monkeypatch.setenv("GIT_TOKEN", "ghp_secret")
    monkeypatch.setenv("GIT_TOKEN_HOST", "github.tools.sap")
    monkeypatch.delenv("GIT_TOKEN_FILE", raising=False)
    creds = gitauth.credentials_for("https://github.tools.sap/org/repo.git")
    assert creds == ("x-access-token", "ghp_secret")


def test_credentials_for_non_matching_host_is_none(monkeypatch):
    from app import gitauth
    monkeypatch.setenv("GIT_TOKEN", "ghp_secret")
    monkeypatch.setenv("GIT_TOKEN_HOST", "github.tools.sap")
    monkeypatch.delenv("GIT_TOKEN_FILE", raising=False)
    # A public github.com repo must NOT receive the internal-host token.
    assert gitauth.credentials_for("https://github.com/org/repo.git") is None


def test_credentials_for_no_token_configured_is_none(monkeypatch):
    from app import gitauth
    monkeypatch.delenv("GIT_TOKEN", raising=False)
    monkeypatch.delenv("GIT_TOKEN_FILE", raising=False)
    monkeypatch.setenv("GIT_TOKEN_HOST", "github.tools.sap")
    assert gitauth.credentials_for("https://github.tools.sap/org/repo.git") is None


def test_credentials_for_rejects_non_http(monkeypatch):
    from app import gitauth
    monkeypatch.setenv("GIT_TOKEN", "ghp_secret")
    monkeypatch.setenv("GIT_TOKEN_HOST", "github.tools.sap")
    monkeypatch.delenv("GIT_TOKEN_FILE", raising=False)
    # An ssh/git-protocol URL never gets the token (only http(s) askpass is supported).
    assert gitauth.credentials_for("git@github.tools.sap:org/repo.git") is None


def test_askpass_prelude_never_contains_token():
    from app import gitauth
    # The prelude only wires GIT_ASKPASS to echo $GIT_PASSWORD — the literal token is passed
    # via env, never baked into the clone command string.
    assert "$GIT_PASSWORD" in gitauth.ASKPASS_PRELUDE
    assert "GIT_ASKPASS" in gitauth.ASKPASS_PRELUDE


# ── keycloak._ensure_client wrappers: redirect URIs (#8 refactor — no behaviour change) ─────────────

def test_ensure_app_client_redirect_uris(monkeypatch):
    from app import keycloak
    captured: dict = {}

    def _fake_ensure(name, redirect_uris, web_origins, *, log_prefix, error_msg):
        captured.update(name=name, redirect_uris=redirect_uris, web_origins=web_origins,
                        log_prefix=log_prefix)
        return f"aitrust-app-{name}"

    monkeypatch.setattr(keycloak, "_ensure_client", _fake_ensure)
    cid = keycloak.ensure_app_client("weather", "https://weather.example.com/")
    assert cid == "aitrust-app-weather"
    # bearer app: wildcard under the app's own base; trailing slash trimmed.
    assert captured["redirect_uris"] == ["https://weather.example.com/*"]
    assert captured["web_origins"] == ["https://weather.example.com"]
    assert captured["log_prefix"] == "marketplace.kc_client"


def test_ensure_federation_client_uses_explicit_redirect(monkeypatch):
    from app import keycloak
    captured: dict = {}

    def _fake_ensure(name, redirect_uris, web_origins, *, log_prefix, error_msg):
        captured.update(redirect_uris=redirect_uris, web_origins=web_origins, log_prefix=log_prefix)
        return f"aitrust-app-{name}"

    monkeypatch.setattr(keycloak, "_ensure_client", _fake_ensure)
    keycloak.ensure_federation_client(
        "fedapp", "https://fedapp.example.com/oauth/callback", "https://fedapp.example.com"
    )
    # federation with an explicit callback: whitelist EXACTLY that (no open wildcard).
    assert captured["redirect_uris"] == ["https://fedapp.example.com/oauth/callback"]
    assert captured["web_origins"] == ["https://fedapp.example.com"]
    assert captured["log_prefix"] == "marketplace.kc_federation_client"


def test_ensure_federation_client_falls_back_to_wildcard(monkeypatch):
    from app import keycloak
    captured: dict = {}

    def _fake_ensure(name, redirect_uris, web_origins, *, log_prefix, error_msg):
        captured.update(redirect_uris=redirect_uris)
        return f"aitrust-app-{name}"

    monkeypatch.setattr(keycloak, "_ensure_client", _fake_ensure)
    keycloak.ensure_federation_client("fedapp", None, "https://fedapp.example.com/")
    # No explicit callback → fall back to the base wildcard (trailing slash trimmed).
    assert captured["redirect_uris"] == ["https://fedapp.example.com/*"]


# ── discovery SSRF guard: metadata / loopback always blocked (#2 health probe reuses it) ────────────

def test_reject_metadata_ip_always_blocked(monkeypatch):
    from app import discovery
    # Even with the private-allow flag on, the cloud metadata IP is blocked.
    monkeypatch.setenv("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", "true")
    monkeypatch.setattr(
        discovery.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("169.254.169.254", 0))],
    )
    with pytest.raises(HTTPException) as exc:
        discovery._reject_if_unsafe("metadata.internal")
    assert exc.value.status_code == 400


def test_reject_loopback_always_blocked(monkeypatch):
    from app import discovery
    monkeypatch.setenv("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", "true")
    monkeypatch.setattr(
        discovery.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 0))],
    )
    with pytest.raises(HTTPException) as exc:
        discovery._reject_if_unsafe("localhost")
    assert exc.value.status_code == 400


def test_reject_private_blocked_without_flag(monkeypatch):
    from app import discovery
    monkeypatch.delenv("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", raising=False)
    monkeypatch.setattr(
        discovery.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("10.1.2.3", 0))],
    )
    with pytest.raises(HTTPException):
        discovery._reject_if_unsafe("internal.host")


def test_allow_private_when_flag_set(monkeypatch):
    from app import discovery
    monkeypatch.setenv("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", "true")
    monkeypatch.setattr(
        discovery.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("10.1.2.3", 0))],
    )
    # RFC-1918 is permitted for in-cluster targets when the flag is on — no raise.
    discovery._reject_if_unsafe("internal.host")


def test_allow_public_ip(monkeypatch):
    from app import discovery
    monkeypatch.delenv("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", raising=False)
    monkeypatch.setattr(
        discovery.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))],  # example.com
    )
    discovery._reject_if_unsafe("example.com")  # no raise
