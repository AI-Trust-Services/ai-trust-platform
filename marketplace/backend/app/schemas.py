from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_NAME_RE = re.compile(r"^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$")  # RFC-1123 label, must serve k8s names
_AUTH_MODES = ("bearer", "header_map", "none", "oidc_federation")


def _check_name(v: str) -> str:
    if not _NAME_RE.match(v):
        raise ValueError("name must be a lowercase RFC-1123 label (a-z, 0-9, '-')")
    return v


def _check_auth_mode(v: str) -> str:
    if v not in _AUTH_MODES:
        raise ValueError(f"auth_mode must be one of {_AUTH_MODES}")
    return v


class ServiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=63, description="k8s-safe slug, e.g. 'weather'")
    label: str = Field(..., min_length=1, max_length=200)
    # git repo to deploy from. Required for static/dockerfile; unused (may be blank) for kind="image".
    git_url: str = Field(default="", max_length=2000)
    git_ref: str = Field(default="main", max_length=200)
    source: str = Field(default="internal")  # internal | external
    open_mode: str = Field(default="same_window")  # same_window | new_tab
    # For source="external", the URL the tile opens (no deploy happens).
    external_url: str | None = None
    # internal only: how the app is deployed. "static" = git-clone + nginx; "dockerfile" = build the
    # repo's Dockerfile into an image, push to the registry, run the container; "image" = pull a
    # prebuilt public image ref and run it (no build).
    kind: str = Field(default="static")  # static | dockerfile | image
    # image only: the public image ref to pull and run (e.g. "ghcr.io/acme/app:1.2").
    image_ref: str | None = Field(default=None, max_length=512)
    # dockerfile/image only: the port the container listens on.
    app_port: int | None = Field(default=None, ge=1, le=65535)
    # dockerfile/image only: wire the app to Platform SSO (mint a per-app Keycloak client + inject
    # OIDC_* env) and role-gate it. Static apps and non-SSO server apps stay ungated.
    sso_enabled: bool = Field(default=False)
    # image only: the ref lives in a private registry needing pull credentials. Non-secret flag only;
    # the credentials themselves are supplied at deploy time (DeployRequest), never on this schema.
    registry_private: bool = Field(default=False)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        return _check_name(v)

    @field_validator("source")
    @classmethod
    def _valid_source(cls, v: str) -> str:
        if v not in ("internal", "external"):
            raise ValueError("source must be 'internal' or 'external'")
        return v

    @field_validator("open_mode")
    @classmethod
    def _valid_open_mode(cls, v: str) -> str:
        if v not in ("same_window", "new_tab"):
            raise ValueError("open_mode must be 'same_window' or 'new_tab'")
        return v

    @field_validator("kind")
    @classmethod
    def _valid_kind(cls, v: str) -> str:
        if v not in ("static", "dockerfile", "image"):
            raise ValueError("kind must be 'static', 'dockerfile', or 'image'")
        return v

    @model_validator(mode="after")
    def _valid_deploy_shape(self) -> "ServiceCreate":
        server_kinds = ("dockerfile", "image")
        # static/dockerfile deploy from a git repo; image pulls a prebuilt ref instead.
        if self.source == "internal" and self.kind in ("static", "dockerfile") and not (self.git_url or "").strip():
            raise ValueError(f"git_url is required when kind='{self.kind}'")
        if self.kind in server_kinds and self.app_port is None:
            raise ValueError(f"app_port is required when kind='{self.kind}'")
        if self.kind not in server_kinds and self.sso_enabled:
            raise ValueError("sso_enabled requires a server app (kind='dockerfile' or 'image')")
        if self.kind == "image" and not (self.image_ref or "").strip():
            raise ValueError("image_ref is required when kind='image'")
        if self.kind == "image" and self.image_ref and any(c.isspace() for c in self.image_ref):
            raise ValueError("image_ref must not contain whitespace")
        if self.registry_private and self.kind != "image":
            raise ValueError("registry_private is only valid when kind='image'")
        return self


# ── Discovery / federation ──────────────────────────────────────────────────────────────────────


class ManifestAuth(BaseModel):
    """The ``auth`` block of an app's well-known manifest — how the proxy federates identity."""

    mode: str = Field(default="bearer")
    header_name: str | None = Field(default=None, max_length=100)
    value_template: str | None = None
    audience: str | None = Field(default=None, max_length=255)
    # oidc_federation only: the app's own OIDC callback (its IAS/IdP reply URL) the platform-IdP
    # client must whitelist. A manifest may self-declare it; otherwise the operator supplies it.
    redirect_uri: str | None = Field(default=None, max_length=2000)

    @field_validator("mode")
    @classmethod
    def _valid_mode(cls, v: str) -> str:
        return _check_auth_mode(v)


class AppManifest(BaseModel):
    """Shape of ``GET {base_url}/.well-known/ai-trust-app.json`` — see marketplace/docs/discovery.md."""

    name: str = Field(..., min_length=1, max_length=63)
    label: str = Field(..., min_length=1, max_length=200)
    base_url: str = Field(..., min_length=1)
    health_url: str | None = None
    auth: ManifestAuth = Field(default_factory=ManifestAuth)
    icon: str | None = Field(default=None, max_length=200)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        return _check_name(v)


class DiscoverRequest(BaseModel):
    """Operator pastes the app's well-known manifest URL; the platform fetches + ingests it."""

    manifest_url: str = Field(..., min_length=1)


class DiscoveredAppCreate(BaseModel):
    """Manual (operator-form) registration of an already-running external app."""

    name: str = Field(..., min_length=1, max_length=63)
    label: str = Field(..., min_length=1, max_length=200)
    external_url: str = Field(..., min_length=1)
    health_url: str | None = None
    auth_mode: str = Field(default="bearer")
    auth_header_name: str | None = Field(default=None, max_length=100)
    auth_value_template: str | None = None
    # oidc_federation only: the app's own OIDC callback the platform-IdP client whitelists.
    oidc_redirect_uri: str | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        return _check_name(v)

    @field_validator("auth_mode")
    @classmethod
    def _valid_auth_mode(cls, v: str) -> str:
        return _check_auth_mode(v)


class EnableRoleRequest(BaseModel):
    role: str = Field(..., min_length=1, max_length=255)


class DeployRequest(BaseModel):
    """Optional body for ``POST /services/{id}/deploy``.

    Carries private-registry pull credentials for a ``kind="image"`` app marked ``registry_private``.
    Deploy-time write-through: the credentials are used to pull the image (compose ``auth_config`` /
    k8s dockerconfigjson pull Secret) and are NEVER persisted in Postgres, returned on any response,
    or logged — the same never-persist contract as OIDC_CLIENT_SECRET. Both fields are optional so a
    public app (or a non-private redeploy) can POST with no body exactly as before; the router
    requires both when the target row is ``registry_private``.
    """

    registry_username: str | None = Field(default=None, max_length=255)
    registry_token: str | None = Field(default=None, max_length=4096)


class EnablementResponse(BaseModel):
    """Toggle state for the Discover UI. Full lists only returned to operators."""

    enabled_for_me: bool
    enabled_users: list[str] | None = None
    enabled_roles: list[str] | None = None


class ServiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    label: str
    git_url: str
    git_ref: str
    kind: str
    # dockerfile apps only (null for static/external rows). image_ref is the pushed image ref
    # (registry/mkt-<name>:<git_ref>); the client secret is NEVER exposed here — Keycloak is SoR.
    app_port: int | None = None
    image_ref: str | None = None
    sso_enabled: bool = False
    # image only: the ref needs private-registry pull credentials. Non-secret flag; the credentials
    # are supplied at deploy time and NEVER returned here.
    registry_private: bool = False
    source: str
    open_mode: str
    status: str
    service_host: str | None
    error: str | None
    # Discovery / federation (null for legacy internal/external rows).
    discovery_source: str | None = None
    manifest_url: str | None = None
    external_url: str | None = None
    health_url: str | None = None
    # Last health-probe outcome for a discovered app (written by marketplace-health-worker). Distinct
    # from ``status`` (the deploy lifecycle). "up"/"down"/"unknown"; null until the first probe.
    health_status: str | None = None
    health_checked_at: datetime | None = None
    oidc_client_id: str | None = None
    auth_mode: str | None = None
    auth_header_name: str | None = None
    auth_value_template: str | None = None
    oidc_redirect_uri: str | None = None
    # Populated by GET /services for discovered apps so the UI can render the toggle.
    enabled_for_me: bool | None = None
    created_at: datetime
    updated_at: datetime


class FederationSetup(BaseModel):
    """The copy-paste "Federation setup" block for an ``oidc_federation`` app (operator-only).

    Returned by ``GET /services/{id}/federation-setup``. Contains the per-app confidential client
    credentials + the platform ``ai-trust`` realm's OIDC endpoints, so the app owner can register
    the platform as a trusted upstream OIDC IdP in their own IAS/BTP tenant (one-time, manual). The
    ``client_secret`` is read live from Keycloak and MUST NOT appear on any unauthenticated response.
    """

    client_id: str
    client_secret: str
    issuer: str
    discovery_url: str
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str
    jwks_uri: str
    scopes: list[str]
    redirect_uri: str | None = None
