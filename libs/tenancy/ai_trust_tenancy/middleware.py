from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse

from ai_trust_tenancy.config import MODE, validate
from ai_trust_tenancy.context import tenant_id_var
from ai_trust_tenancy.resolver import resolve_tenant
from ai_trust_tenancy.security_preflight import check_no_default_secrets

# Paths that must work without a resolved tenant (liveness/readiness probes, docs).
_EXEMPT_SUFFIXES = ("/health", "/docs", "/openapi.json", "/redoc")


def install_tenant_middleware(app) -> None:
    """Mount tenant resolution as an HTTP middleware.

    Mirrors the logging_middleware pattern in each backend's main.py: it sets a
    ContextVar per request, which then propagates through every `await` (so the DB
    session hook can read it). In `jwt` mode a request that resolves no tenant is
    rejected 401 (fail-closed), except for infra paths. In `single`/`header` modes an
    unresolved tenant is allowed (None → RLS shows only shared rows).

    Fail-fast: validate() raises at install time (app startup) if TENANCY_MODE is invalid
    or jwt mode is missing its issuer anchor — so a misconfigured backend refuses to start
    rather than silently accepting any issuer.
    """
    validate()
    check_no_default_secrets()
    if MODE == "single":
        return  # no-op: preserve single-tenant behaviour exactly

    @app.middleware("http")
    async def tenant_middleware(request: Request, call_next):
        tenant = resolve_tenant(request)
        if MODE == "jwt" and not tenant:
            path = request.url.path.rstrip("/")
            if not any(path.endswith(s.rstrip("/")) for s in _EXEMPT_SUFFIXES):
                return JSONResponse({"detail": "tenant unresolved"}, status_code=401)
        tenant_id_var.set(tenant)
        return await call_next(request)
