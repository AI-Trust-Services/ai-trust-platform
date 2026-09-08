from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class MarketplaceService(Base):
    """A service added to the in-app Marketplace.

    ``source`` = "internal"            → we clone + run it on THIS cluster; opens same-window
                                          (embedded, served same-origin via the marketplace proxy).
    ``source`` = "external"            → runs elsewhere, we only store a URL; opens in a new tab.
    ``source`` = "external_discovered" → an already-running app DISCOVERED into the platform. Not
                                          deployed by us. How it opens + how auth is federated depend
                                          on ``auth_mode``: ``bearer``/``header_map``/``none`` are
                                          embedded same-origin through the proxy, which injects the
                                          caller's platform identity; ``oidc_federation`` opens in a
                                          NEW TAB at ``external_url`` and the app runs its OWN OIDC
                                          login, which now trusts the platform ``ai-trust`` realm as
                                          an upstream IdP (real SSO transfer, zero app code — the
                                          proxy injects nothing). Visibility is per-user/per-role via
                                          the join tables below (no ``enabled`` column).

    ``kind`` selects how an internal (source="internal") app is deployed:
      "static"     → git-clone initContainer + nginx serving the repo's root index.html on :80.
      "dockerfile" → build the repo's Dockerfile into an image (Kaniko Job on k8s / ``docker build``
                     on compose), push to the in-cluster registry, and run the container. When
                     ``sso_enabled`` is set, the platform mints a per-app Keycloak client and injects
                     generic OIDC_* env so the app runs its OWN OIDC login against the ``ai-trust``
                     realm; such apps are role-gated (visibility + proxy) via the join tables below.
    """

    __tablename__ = "marketplace_services"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # MKT-XXXXXXXX
    name: Mapped[str] = mapped_column(String(63), nullable=False, unique=True, index=True)  # k8s-safe
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    git_url: Mapped[str] = mapped_column(Text, nullable=False)
    git_ref: Mapped[str] = mapped_column(String(200), nullable=False, default="main")
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="static")  # static|dockerfile
    # dockerfile only: the port the built container listens on (the k8s Service targetPort / the
    # compose upstream port). Null for static apps (nginx :80).
    app_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # dockerfile only: wire the app to Platform SSO — mint a per-app Keycloak client, inject OIDC_*
    # env, and role-gate the app (visibility + proxy). Static apps and non-SSO dockerfile apps stay
    # ungated (returned to everyone), preserving the legacy internal behaviour.
    sso_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="internal"
    )  # internal|external|external_discovered
    open_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="same_window")  # same_window|new_tab
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )  # pending|deploying|running|failed
    # In-cluster Service name backing an internal service (e.g. "weather-svc"); or the
    # external URL for legacy source="external" (new-tab) services.
    service_host: Mapped[str | None] = mapped_column(Text, nullable=True)
    # dockerfile only: the full image ref pushed to the registry (e.g.
    # "registry:5000/mkt-weather:main"), stored for reproducible run/redeploy.
    image_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    # image only: the ref requires registry pull credentials. This is the ONLY private-registry
    # state persisted — a non-secret flag. The credentials themselves (username/token) are supplied
    # at deploy time (POST /services/{id}/deploy body), written straight into a per-app pull Secret
    # (k8s) or passed to the pull call in memory (compose), and NEVER stored in Postgres or returned
    # on any response — the same never-persist contract as OIDC_CLIENT_SECRET.
    registry_private: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    # dockerfile/image only: operator-supplied plain environment variables injected into the deployed
    # container (compose ``environment=`` / k8s plain ``V1EnvVar``). NON-SECRET config only — secrets
    # and registry pull credentials never go here (those travel through the deploy-time body and are
    # never persisted). For a same_window server app the deploy path auto-adds ISSUER=<proxy base>
    # unless the operator already set it, so an app that runs its own OIDC login resolves through the
    # marketplace proxy. Defaults to {} so pre-existing rows stay valid.
    env: Mapped[dict[str, str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Discovery / federation (source="external_discovered") ───────────────────────────────────
    # How the row was ingested: "manual" (operator form) or "manifest" (self-describe pull).
    discovery_source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    # Well-known manifest URL the app self-describes at (null for manual registration).
    manifest_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Canonical base URL of the already-running app — the proxy upstream. Kept separate from
    # ``service_host`` so the legacy new-tab external semantics are untouched.
    external_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional health endpoint for status probing.
    health_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Last health-probe outcome, written by marketplace-health-worker (never by the deploy path).
    # Distinct from ``status`` (the deploy lifecycle): "up"/"down"/"unknown", null until first probe.
    health_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    health_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The per-app Keycloak client (aitrust-app-<name>) created lazily on first enable.
    oidc_client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # How the proxy federates identity to the app:
    #   "bearer"          → forward the platform JWT as Authorization: Bearer <jwt>
    #   "header_map"      → set <auth_header_name> to <auth_value_template> rendered from platform identity
    #   "none"            → strip all identity (public app)
    #   "oidc_federation" → inject NOTHING; the app runs its own OIDC login federated to the platform
    #                       ``ai-trust`` realm (opens in a new tab; real SSO transfer, zero app code).
    auth_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="bearer")
    auth_header_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Template rendered from {preferred_username, email, jwt, sub}, e.g. "{preferred_username}".
    auth_value_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    # oidc_federation only: the app-side OIDC callback (its IAS/IdP reply URL) that the per-app
    # platform-IdP client whitelists. Operator-supplied — not derivable, not the same as external_url.
    oidc_redirect_uri: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class MarketplaceAppEnabledUser(Base):
    """Per-user opt-in for a discovered app — a row means the app is enabled for that user.

    Catalog visibility (operational state), NOT authorization: OpenFGA still gates who may
    enable-for-a-role and who may reach the proxy. Enable = insert (idempotent via
    ON CONFLICT DO NOTHING), disable = delete. Composite PK (app_id, username); no ORM
    ``relationship`` per the M2M convention.
    """

    __tablename__ = "marketplace_app_enabled_users"

    app_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("marketplace_services.id", ondelete="CASCADE"), primary_key=True
    )
    username: Mapped[str] = mapped_column(String(255), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ix_mkt_enabled_users_username", "username"),)


class MarketplaceAppEnabledRole(Base):
    """Per-role opt-in for a discovered app — enabled for every member of ``role``.

    Role identity is resolved at read time via OpenFGA (``read_user_roles``); this table only
    records which roles an operator turned the app on for. Composite PK (app_id, role).
    """

    __tablename__ = "marketplace_app_enabled_roles"

    app_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("marketplace_services.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(255), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ix_mkt_enabled_roles_role", "role"),)
