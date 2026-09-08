from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_authorization import check_permission, get_current_user, require_permission
from ai_trust_authorization.constants import IAM_MANAGE, MARKETPLACE_MANAGE
from ai_trust_authorization.openfga_client import read_user_roles
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.marketplace import (
    MarketplaceAppEnabledRole,
    MarketplaceAppEnabledUser,
    MarketplaceService,
)

from app import deploy, discovery, identity, keycloak, ocm, oidc
from app.ids import new_id
from app.schemas import (
    DeployRequest,
    DiscoveredAppCreate,
    DiscoverRequest,
    EnablementResponse,
    EnableRoleRequest,
    FederationSetup,
    OcmIngestRequest,
    ServiceCreate,
    ServiceResponse,
)

router = APIRouter(tags=["services"])
logger = get_logger(__name__)

# Hop-by-hop headers that must not be forwarded through the proxy.
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length", "content-encoding",
}


async def _user_roles(user: str) -> set[str]:
    """Bare role names (e.g. {'auditor'}) the user belongs to, from OpenFGA role objects."""
    try:
        objs = await read_user_roles(f"user:{user}")
    except Exception:  # noqa: BLE001 — fail closed: no roles rather than an open door
        logger.warning("marketplace.roles.read_failed", extra={"user": user})
        return set()
    return {o.split(":", 1)[1] for o in objs if ":" in o}


# Deploy target — governs the upstream port the proxy dials for an internal service (see
# _upstream_port). On k8s every internal Service is published on :80 (targetPort maps to the
# app's real port); on docker-compose the container is reached by name on its actual listen port.
_DEPLOY_TARGET = os.environ.get("DEPLOY_TARGET", "kubernetes").lower()


def _upstream_port(row: MarketplaceService) -> int:
    """The port the proxy dials on ``service_host``. k8s: always 80 (the Service maps :80 →
    targetPort). docker: static nginx is :80; a server app (dockerfile/image) is on its own
    ``app_port``."""
    if _DEPLOY_TARGET == "docker" and row.kind in ("dockerfile", "image") and row.app_port:
        return int(row.app_port)
    return 80


def _is_gated(row: MarketplaceService) -> bool:
    """Which rows are visibility/proxy role-gated (OpenFGA enablement).

    - ``external_discovered`` → always gated (unchanged legacy behaviour).
    - internal server app (``dockerfile``/``image``) with ``sso_enabled`` → gated (wired to
      Platform SSO).
    - static internal + external + non-SSO server app → ungated, returned/proxied to everyone, so
      existing static apps are NEVER retro-hidden."""
    if row.source == "external_discovered":
        return True
    return row.kind in ("dockerfile", "image") and bool(row.sso_enabled)


async def _is_enabled_for(session, app_id: str, user: str, roles: set[str]) -> bool:
    """True if a discovered app is enabled for this user directly or via one of their roles."""
    if (await session.execute(
        select(MarketplaceAppEnabledUser).where(
            MarketplaceAppEnabledUser.app_id == app_id,
            MarketplaceAppEnabledUser.username == user,
        )
    )).scalar_one_or_none():
        return True
    if roles:
        hit = (await session.execute(
            select(MarketplaceAppEnabledRole.role).where(
                MarketplaceAppEnabledRole.app_id == app_id,
                MarketplaceAppEnabledRole.role.in_(roles),
            )
        )).first()
        if hit:
            return True
    return False


@router.get("/services", response_model=list[ServiceResponse])
async def list_services(
    request: Request,
    status: str | None = Query(default=None, description="Filter by status, e.g. 'running'"),
) -> list[ServiceResponse]:
    """Catalog listing. No permission gate: read-only, and luigi-config.js (unauth-safe) calls
    this with ?status=running to build the Services menu. Mutations below are gated.

    Discovered apps (source='external_discovered') are visibility-scoped: a row is returned only if
    enabled for the caller (own enable, or a role they hold). Legacy internal/external rows are
    returned to everyone as before. ``enabled_for_me`` is populated for discovered rows so the
    Discover UI can render the toggle."""
    try:
        user = get_current_user(request)
    except HTTPException:
        user = ""
    roles = await _user_roles(user) if user else set()

    async with SessionLocal() as session:
        stmt = select(MarketplaceService).order_by(MarketplaceService.label)
        if status:
            stmt = stmt.where(MarketplaceService.status == status)
        rows = (await session.execute(stmt)).scalars().all()

        out: list[ServiceResponse] = []
        for r in rows:
            if _is_gated(r):
                enabled = bool(user) and await _is_enabled_for(session, r.id, user, roles)
                if not enabled:
                    continue
                resp = ServiceResponse.model_validate(r)
                resp.enabled_for_me = True
                out.append(resp)
            else:
                out.append(ServiceResponse.model_validate(r))
        return out


@router.post("/services", response_model=ServiceResponse, status_code=201,
             dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def add_service(body: ServiceCreate) -> ServiceResponse:
    async with SessionLocal() as session:
        row = await _create_internal(session, body)
        await session.commit()
        await session.refresh(row)
    logger.info("marketplace.service.added", extra={"id": row.id, "service": row.name, "source": row.source})
    return ServiceResponse.model_validate(row)


async def _create_internal(session, body: ServiceCreate) -> MarketplaceService:
    """Build and add (not commit) a MarketplaceService row from a validated ServiceCreate.

    The single register/persist path — shared by ``POST /services`` and ``POST /discover/ocm`` (which
    resolves an OCM component to a ``kind="image"`` ServiceCreate first). The caller owns the
    transaction and commits, per the repo's session convention."""
    exists = await session.execute(
        select(MarketplaceService).where(MarketplaceService.name == body.name)
    )
    if exists.scalar_one_or_none():
        raise HTTPException(409, f"A service named '{body.name}' already exists")

    _server_kinds = ("dockerfile", "image")
    row = MarketplaceService(
        id=new_id("MKT"),
        name=body.name,
        label=body.label,
        git_url=body.git_url,
        git_ref=body.git_ref,
        kind=body.kind if body.source != "external" else "static",
        app_port=body.app_port if body.kind in _server_kinds else None,
        sso_enabled=body.sso_enabled if body.kind in _server_kinds else False,
        # image only: the operator-supplied public image ref to pull-and-run.
        image_ref=body.image_ref if body.kind == "image" else None,
        # image only: the ref needs private-registry pull credentials (supplied at deploy time).
        registry_private=body.registry_private if body.kind == "image" else False,
        source=body.source,
        # Honor open_mode for external apps AND for internal server apps (dockerfile/image):
        # a running app that can't live under the same-origin embed base path can be opened in
        # a new tab through the proxy. Static sites are always embedded (same_window).
        open_mode=(
            body.open_mode
            if (body.source == "external" or body.kind in _server_kinds)
            else "same_window"
        ),
        status="running" if body.source == "external" else "pending",
        # For external services there is nothing to deploy — store the URL to open.
        service_host=body.external_url if body.source == "external" else None,
    )
    session.add(row)
    return row


@router.post("/discover/ocm", response_model=ServiceResponse, status_code=201,
             dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def ingest_ocm(body: OcmIngestRequest) -> ServiceResponse:
    """Resolve an OCM component version to its ociImage ref and register it as a kind="image" service.

    A thin resolver in front of the normal register flow: the operator pastes a component reference
    (repo + component) instead of the exact, un-guessable digest-pinned image ref; we shell to the
    ``ocm`` CLI to read the descriptor, then persist through the same ``_create_internal`` path as
    ``POST /services``. The result is an internal ``kind="image"`` row at ``status="pending"`` — deploy
    is the normal separate ``POST /services/{id}/deploy`` step (with pull credentials in the body when
    ``registry_private``)."""
    resolved = await ocm.resolve_component(
        body.ocm_repo, body.component, body.resource,
        # Write-through resolve credentials for a private OCM descriptor repo (never persisted/logged).
        creds=((body.resolve_username, body.resolve_token)
               if body.resolve_username and body.resolve_token else None),
    )
    sc = ServiceCreate(
        name=body.name,
        label=body.label,
        kind="image",
        image_ref=resolved.image_ref,
        app_port=body.app_port,
        open_mode=body.open_mode,
        registry_private=body.registry_private,
        sso_enabled=body.sso_enabled,
        source="internal",
    )
    async with SessionLocal() as session:
        row = await _create_internal(session, sc)
        await session.commit()
        await session.refresh(row)
    # image_ref is non-secret (a public/digest-pinned OCI ref); never log any registry pull token.
    logger.info(
        "marketplace.ocm.ingested",
        extra={"id": row.id, "service": row.name, "component": body.component,
               "image_ref": resolved.image_ref},
    )
    return ServiceResponse.model_validate(row)


# ── Discovery / federation ───────────────────────────────────────────────────────────────────────


async def _upsert_discovered(
    session, *, name: str, label: str, external_url: str, health_url: str | None,
    auth_mode: str, auth_header_name: str | None, auth_value_template: str | None,
    discovery_source: str, manifest_url: str | None, oidc_redirect_uri: str | None = None,
) -> MarketplaceService:
    """Create or re-sync a source='external_discovered' row, keyed on ``name`` (idempotent).

    ``oidc_federation`` apps open in a NEW TAB at ``external_url`` (their own OIDC login, federated to
    the platform ``ai-trust`` realm) rather than embedded through the proxy — so ``open_mode`` is set
    to ``new_tab`` for that mode. All other modes stay ``same_window`` (embedded)."""
    row = (await session.execute(
        select(MarketplaceService).where(MarketplaceService.name == name)
    )).scalar_one_or_none()
    if row and row.source != "external_discovered":
        raise HTTPException(409, f"A non-discovered service named '{name}' already exists")
    if row is None:
        row = MarketplaceService(id=new_id("MKT"), name=name, git_url="", git_ref="main", kind="static")
        session.add(row)
    row.label = label
    row.source = "external_discovered"
    row.open_mode = "new_tab" if auth_mode == "oidc_federation" else "same_window"
    row.status = "running"  # already running elsewhere; nothing for us to deploy
    row.external_url = external_url
    row.health_url = health_url
    row.auth_mode = auth_mode
    row.auth_header_name = auth_header_name
    row.auth_value_template = auth_value_template
    row.oidc_redirect_uri = oidc_redirect_uri
    row.discovery_source = discovery_source
    row.manifest_url = manifest_url
    return row


@router.get("/services/discoverable", response_model=list[ServiceResponse],
            dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def list_discoverable() -> list[ServiceResponse]:
    """Operator view: ALL discovered apps regardless of enablement (for the Discover section)."""
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(MarketplaceService)
            .where(MarketplaceService.source == "external_discovered")
            .order_by(MarketplaceService.label)
        )).scalars().all()
        return [ServiceResponse.model_validate(r) for r in rows]


@router.post("/discover", response_model=ServiceResponse, status_code=201,
             dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def discover(body: DiscoverRequest) -> ServiceResponse:
    """Fetch an app's well-known manifest (SSRF-guarded), validate it, and upsert a discovered row.
    Re-POSTing the same manifest re-syncs (idempotent on the manifest's ``name``)."""
    raw = await discovery.fetch_manifest(body.manifest_url)
    from app.schemas import AppManifest  # local import avoids a cycle at module load

    try:
        manifest = AppManifest.model_validate(raw)
    except Exception as exc:  # noqa: BLE001 — surface a clean 422-ish message
        raise HTTPException(422, f"Manifest failed validation: {exc}") from exc

    async with SessionLocal() as session:
        row = await _upsert_discovered(
            session,
            name=manifest.name, label=manifest.label, external_url=manifest.base_url,
            health_url=manifest.health_url, auth_mode=manifest.auth.mode,
            auth_header_name=manifest.auth.header_name, auth_value_template=manifest.auth.value_template,
            oidc_redirect_uri=manifest.auth.redirect_uri,
            discovery_source="manifest", manifest_url=body.manifest_url,
        )
        await session.commit()
        await session.refresh(row)
    logger.info("marketplace.discovered", extra={"id": row.id, "service": row.name, "source": "manifest"})
    return ServiceResponse.model_validate(row)


@router.post("/discover/manual", response_model=ServiceResponse, status_code=201,
             dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def discover_manual(body: DiscoveredAppCreate) -> ServiceResponse:
    """Operator-form registration of an already-running external app (no manifest)."""
    async with SessionLocal() as session:
        row = await _upsert_discovered(
            session,
            name=body.name, label=body.label, external_url=body.external_url,
            health_url=body.health_url, auth_mode=body.auth_mode,
            auth_header_name=body.auth_header_name, auth_value_template=body.auth_value_template,
            oidc_redirect_uri=body.oidc_redirect_uri,
            discovery_source="manual", manifest_url=None,
        )
        await session.commit()
        await session.refresh(row)
    logger.info("marketplace.discovered", extra={"id": row.id, "service": row.name, "source": "manual"})
    return ServiceResponse.model_validate(row)


async def _load_discovered(session, service_id: str) -> MarketplaceService:
    """Load a row that supports per-user/per-role enablement: a discovered app OR an SSO-gated
    dockerfile app (``_is_gated``). Other rows (static internal, external) have no enablement."""
    row = (await session.execute(
        select(MarketplaceService).where(MarketplaceService.id == service_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Service {service_id} not found")
    if not _is_gated(row):
        raise HTTPException(400, "Enable/disable applies only to discovered or SSO-gated apps")
    return row


async def _ensure_client_on_enable(row: MarketplaceService) -> None:
    """Lazily provision the per-app Keycloak client on first enable, keyed on the app's auth_mode.

    ``bearer``          → ``ensure_app_client`` (the app validates the forwarded platform JWT).
    ``oidc_federation`` → ``ensure_federation_client`` (the app's own IdP brokers TO the platform
                          ``ai-trust`` realm; the client's redirect URI is the APP's IAS/OIDC callback).
    ``header_map`` / ``none`` need no client. Idempotent: skipped once ``oidc_client_id`` is set."""
    if row.oidc_client_id or not row.external_url:
        return
    if row.auth_mode == "bearer":
        row.oidc_client_id = keycloak.ensure_app_client(row.name, row.external_url)
    elif row.auth_mode == "oidc_federation":
        row.oidc_client_id = keycloak.ensure_federation_client(
            row.name, row.oidc_redirect_uri, row.external_url
        )


@router.post("/services/{service_id}/enable", response_model=EnablementResponse)
async def enable_for_me(service_id: str, user: str = Depends(get_current_user)) -> EnablementResponse:
    """Self-service enable of a discovered app for the calling user (authenticated only)."""
    async with SessionLocal() as session:
        row = await _load_discovered(session, service_id)
        await _ensure_client_on_enable(row)
        await session.execute(
            pg_insert(MarketplaceAppEnabledUser)
            .values(app_id=row.id, username=user)
            .on_conflict_do_nothing()
        )
        await session.commit()
    logger.info("marketplace.enabled", extra={"id": service_id, "user": user, "scope": "user"})
    return EnablementResponse(enabled_for_me=True)


@router.delete("/services/{service_id}/enable", response_model=EnablementResponse)
async def disable_for_me(service_id: str, user: str = Depends(get_current_user)) -> EnablementResponse:
    async with SessionLocal() as session:
        await _load_discovered(session, service_id)
        await session.execute(
            sql_delete(MarketplaceAppEnabledUser).where(
                MarketplaceAppEnabledUser.app_id == service_id,
                MarketplaceAppEnabledUser.username == user,
            )
        )
        await session.commit()
    logger.info("marketplace.disabled", extra={"id": service_id, "user": user, "scope": "user"})
    return EnablementResponse(enabled_for_me=False)


async def _require_role_manager(request: Request) -> str:
    """Enabling an app for a whole role is an operator action: iam:manage OR marketplace:manage."""
    user = get_current_user(request)
    if await check_permission(user, IAM_MANAGE) or await check_permission(user, MARKETPLACE_MANAGE):
        return user
    raise HTTPException(403, "Permission denied")


@router.post("/services/{service_id}/enable-role", response_model=EnablementResponse)
async def enable_for_role(
    service_id: str, body: EnableRoleRequest, request: Request,
) -> EnablementResponse:
    actor = await _require_role_manager(request)
    async with SessionLocal() as session:
        row = await _load_discovered(session, service_id)
        await _ensure_client_on_enable(row)
        await session.execute(
            pg_insert(MarketplaceAppEnabledRole)
            .values(app_id=row.id, role=body.role)
            .on_conflict_do_nothing()
        )
        await session.commit()
        roles = (await session.execute(
            select(MarketplaceAppEnabledRole.role).where(MarketplaceAppEnabledRole.app_id == service_id)
        )).scalars().all()
    logger.info("marketplace.enabled", extra={"id": service_id, "actor": actor, "role": body.role, "scope": "role"})
    return EnablementResponse(enabled_for_me=True, enabled_roles=list(roles))


@router.delete("/services/{service_id}/enable-role/{role}", response_model=EnablementResponse)
async def disable_for_role(service_id: str, role: str, request: Request) -> EnablementResponse:
    actor = await _require_role_manager(request)
    async with SessionLocal() as session:
        await _load_discovered(session, service_id)
        await session.execute(
            sql_delete(MarketplaceAppEnabledRole).where(
                MarketplaceAppEnabledRole.app_id == service_id,
                MarketplaceAppEnabledRole.role == role,
            )
        )
        await session.commit()
        roles = (await session.execute(
            select(MarketplaceAppEnabledRole.role).where(MarketplaceAppEnabledRole.app_id == service_id)
        )).scalars().all()
    logger.info("marketplace.disabled", extra={"id": service_id, "actor": actor, "role": role, "scope": "role"})
    return EnablementResponse(enabled_for_me=False, enabled_roles=list(roles))


@router.get("/services/{service_id}/enablement", response_model=EnablementResponse)
async def get_enablement(service_id: str, request: Request) -> EnablementResponse:
    """``enabled_for_me`` for anyone; the full user/role lists only for operators."""
    user = get_current_user(request)
    roles = await _user_roles(user)
    is_operator = await check_permission(user, IAM_MANAGE) or await check_permission(user, MARKETPLACE_MANAGE)
    async with SessionLocal() as session:
        await _load_discovered(session, service_id)
        mine = await _is_enabled_for(session, service_id, user, roles)
        resp = EnablementResponse(enabled_for_me=mine)
        if is_operator:
            resp.enabled_users = (await session.execute(
                select(MarketplaceAppEnabledUser.username).where(
                    MarketplaceAppEnabledUser.app_id == service_id)
            )).scalars().all()
            resp.enabled_roles = (await session.execute(
                select(MarketplaceAppEnabledRole.role).where(
                    MarketplaceAppEnabledRole.app_id == service_id)
            )).scalars().all()
        return resp


# ── Federation setup (oidc_federation mode) ───────────────────────────────────────────────────────


def _federation_setup(row: MarketplaceService, client_secret: str) -> FederationSetup:
    """Assemble the copy-paste "Federation setup" block from the app's Keycloak client + the platform
    ``ai-trust`` realm's public OIDC endpoints. Endpoints are derived from ``KEYCLOAK_PUBLIC_URL`` (the
    browser-facing issuer, NOT the in-cluster ``KEYCLOAK_URL``) so the values the app owner registers
    resolve from their own network. 500 if ``KEYCLOAK_PUBLIC_URL`` is unset (hard prerequisite)."""
    public = os.environ.get("KEYCLOAK_PUBLIC_URL", "").rstrip("/")
    if not public:
        raise HTTPException(500, "KEYCLOAK_PUBLIC_URL is not configured on the marketplace backend")
    realm = keycloak.REALM
    issuer = f"{public}/realms/{realm}"
    oidc = f"{issuer}/protocol/openid-connect"
    return FederationSetup(
        client_id=row.oidc_client_id or f"aitrust-app-{row.name}",
        client_secret=client_secret,
        issuer=issuer,
        discovery_url=f"{issuer}/.well-known/openid-configuration",
        authorization_endpoint=f"{oidc}/auth",
        token_endpoint=f"{oidc}/token",
        userinfo_endpoint=f"{oidc}/userinfo",
        jwks_uri=f"{oidc}/certs",
        scopes=["openid", "profile", "email"],
        redirect_uri=row.oidc_redirect_uri,
    )


@router.get("/services/{service_id}/federation-setup", response_model=FederationSetup)
async def get_federation_setup(service_id: str, request: Request) -> FederationSetup:
    """Operator-only. Return the per-app confidential client credentials + the platform ``ai-trust``
    realm OIDC metadata so the app owner can register the platform as a trusted upstream OIDC IdP in
    their own IAS/BTP tenant (one-time, manual). Ensures the Keycloak client exists, then reads its
    secret live (never persisted). 400 unless ``auth_mode=='oidc_federation'``. The returned
    ``client_secret`` is a credential — this endpoint is gated and the value is never logged."""
    actor = await _require_role_manager(request)
    async with SessionLocal() as session:
        row = await _load_discovered(session, service_id)
        if row.auth_mode != "oidc_federation":
            raise HTTPException(400, "Federation setup applies only to oidc_federation apps")
        await _ensure_client_on_enable(row)
        client_id = row.oidc_client_id
        await session.commit()  # persist the lazily-provisioned client id
    secret = keycloak.get_client_secret(client_id)
    logger.info("marketplace.federation.setup_viewed", extra={"id": service_id, "actor": actor})
    # Re-load a lightweight view for endpoint assembly (row is detached after commit).
    async with SessionLocal() as session:
        row = await _load_discovered(session, service_id)
        return _federation_setup(row, secret)


@router.post("/services/{service_id}/federation-setup/rotate", response_model=FederationSetup)
async def rotate_federation_secret(service_id: str, request: Request) -> FederationSetup:
    """Operator-only. Rotate the per-app client secret and return the fresh setup block. The app
    owner must re-register the new secret in their IAS/BTP tenant afterwards."""
    actor = await _require_role_manager(request)
    async with SessionLocal() as session:
        row = await _load_discovered(session, service_id)
        if row.auth_mode != "oidc_federation":
            raise HTTPException(400, "Federation setup applies only to oidc_federation apps")
        await _ensure_client_on_enable(row)
        client_id = row.oidc_client_id
        await session.commit()
    secret = keycloak.rotate_client_secret(client_id)
    logger.info("marketplace.federation.secret_rotated", extra={"id": service_id, "actor": actor})
    async with SessionLocal() as session:
        row = await _load_discovered(session, service_id)
        return _federation_setup(row, secret)


@router.post("/services/{service_id}/deploy", response_model=ServiceResponse,
             dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def deploy_service(service_id: str, body: DeployRequest | None = None) -> ServiceResponse:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.id == service_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Service {service_id} not found")
        if row.source == "external":
            raise HTTPException(400, "External services are not deployed by the platform")
        if row.source == "external_discovered":
            raise HTTPException(400, "Discovered apps run elsewhere and are not deployed by the platform")

        name, git_url, git_ref = row.name, row.git_url, row.git_ref
        kind, app_port, sso_enabled = row.kind, row.app_port, bool(row.sso_enabled)
        row_image_ref = row.image_ref
        registry_private = bool(row.registry_private)

        # Private-registry pulls need deploy-time credentials (never persisted — see DeployRequest).
        # Reject before flipping to "deploying" so a missing-cred deploy leaves status untouched.
        registry_auth: dict[str, str] | None = None
        if kind == "image" and registry_private:
            if not (body and body.registry_username and body.registry_token):
                raise HTTPException(
                    400,
                    "this app is marked private; supply registry_username and registry_token "
                    "in the deploy request body to pull it",
                )
            # registry_token is the API field name (a PAT is a token); the docker/k8s pull-auth key
            # is "password" — deliberate mapping, not a bug. The pull SDK / dockerconfigjson expect
            # {"username", "password"}.
            registry_auth = {"username": body.registry_username, "password": body.registry_token}

        row.status = "deploying"
        row.error = None
        await session.commit()

    host: str | None = None
    image: str | None = None
    client_id: str | None = None
    new_status, err = "running", None
    try:
        if kind in ("dockerfile", "image"):
            env: dict[str, str] = {}
            secret_env: dict[str, str] = {}
            if sso_enabled:
                # Mint (idempotently) the per-app confidential Keycloak client whose redirect URIs
                # cover the app's same-origin embed base, then read its secret live (never persisted).
                client_id = keycloak.ensure_app_client(name, oidc.embed_base(name))
                env = oidc.oidc_env(client_id, name)
                secret_env = {"OIDC_CLIENT_SECRET": keycloak.get_client_secret(client_id)}
            if kind == "dockerfile":
                host, image = await deploy.build_and_deploy(
                    name, git_url, git_ref, int(app_port or 8080), env, secret_env
                )
            else:  # image — pull the operator-supplied ref and run it (no build)
                host, image = await deploy.run_image(
                    name, row_image_ref or "", int(app_port or 8080), env, secret_env,
                    registry_auth=registry_auth,
                )
        else:
            host = await deploy.create_static_service(name, git_url, git_ref)
    except Exception as e:  # noqa: BLE001 — record any failure on the row
        logger.exception("marketplace.deploy.failed", extra={"id": service_id, "service": name})
        host, image, new_status, err = None, None, "failed", str(e)[:2000]

    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.id == service_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Service {service_id} not found")
        row.status = new_status
        row.service_host = host
        row.error = err
        if image is not None:
            row.image_ref = image
        if client_id is not None:
            row.oidc_client_id = client_id
        await session.commit()
        await session.refresh(row)
    logger.info("marketplace.deploy.done", extra={"id": service_id, "service": name, "status": new_status})
    return ServiceResponse.model_validate(row)


@router.get("/services/{service_id}/status", response_model=ServiceResponse)
async def get_status(service_id: str) -> ServiceResponse:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.id == service_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Service {service_id} not found")
        return ServiceResponse.model_validate(row)


@router.delete("/services/{service_id}",
               dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def delete_service(service_id: str) -> dict:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.id == service_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Service {service_id} not found")
        name, source = row.name, row.source
        await session.delete(row)
        await session.commit()

    if source == "internal":
        try:
            await deploy.delete_service(name)
        except Exception as e:  # noqa: BLE001
            logger.warning("marketplace.delete.k8s_failed", extra={"service": name, "error": str(e)})
    logger.info("marketplace.service.deleted", extra={"id": service_id, "service": name})
    return {"status": "deleted", "id": service_id, "name": name}


@router.api_route(
    "/proxy/{name}/{path:path}",
    methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
async def proxy(name: str, path: str, request: Request) -> Response:
    """Reverse-proxy to a running service so it is embeddable SAME-ORIGIN through the shell
    (CSP frame-ancestors 'self'). The Luigi node's viewUrl iframes /marketplace/#/embed/<name>,
    whose page loads assets from /api/marketplace/v1/proxy/<name>/.

    - source='internal'            → deploy-your-own service, upstream = in-cluster service_host,
                                      identity forwarded as-is (unchanged behaviour).
    - source='external_discovered' → already-running app, upstream = external_url; GATED (403 unless
                                      enabled for the caller) and identity FEDERATED/anti-spoofed via
                                      identity.build_upstream_headers per the app's auth_mode."""
    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.name == name)
        )).scalar_one_or_none()
        if not row or row.source not in ("internal", "external_discovered"):
            raise HTTPException(404, f"No proxyable service '{name}'")
        if row.status != "running":
            raise HTTPException(409, f"Service '{name}' is not running (status={row.status})")

        if row.source == "external_discovered":
            # Gate: only a caller the app is enabled for may reach it (anti-spoof identity below).
            user = get_current_user(request)
            roles = await _user_roles(user)
            if not await _is_enabled_for(session, row.id, user, roles):
                logger.warning("marketplace.proxy.denied", extra={"service": name, "user": user})
                raise HTTPException(403, "Not enabled for this application")
            upstream_base = (row.external_url or "").rstrip("/")
            if not upstream_base:
                raise HTTPException(409, f"Service '{name}' has no upstream URL")
            target = f"{upstream_base}/{path}"
            fwd_headers = identity.build_upstream_headers(row, request)
        else:
            if not row.service_host:
                raise HTTPException(409, f"Service '{name}' is not running")
            # SSO-gated dockerfile apps are role-gated exactly like discovered apps (visibility +
            # proxy). Identity is NOT forwarded — the app runs its own OIDC login — so strip inbound
            # identity/host headers (anti-spoof) as for the legacy static internal path.
            if _is_gated(row):
                user = get_current_user(request)
                roles = await _user_roles(user)
                if not await _is_enabled_for(session, row.id, user, roles):
                    logger.warning("marketplace.proxy.denied", extra={"service": name, "user": user})
                    raise HTTPException(403, "Not enabled for this application")
            target = f"http://{row.service_host}:{_upstream_port(row)}/{path}"
            fwd_headers = {
                k: v for k, v in request.headers.items()
                if k.lower() not in _HOP_BY_HOP and k.lower() != "host"
            }

    body = await request.body()
    try:
        async with httpx.AsyncClient(timeout=30.0) as up:
            upstream = await up.request(
                request.method, target, params=request.query_params,
                headers=fwd_headers, content=body,
            )
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Upstream '{name}' unreachable: {e}") from e

    resp_headers = {
        k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=upstream.headers.get("content-type"),
    )
