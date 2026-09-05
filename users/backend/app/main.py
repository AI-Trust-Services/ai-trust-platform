import os
import time
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ai_trust_logging import correlation_id_var, get_logger
from ai_trust_tenancy import install_tenant_middleware
from app.routers import roles, users, permissions, iam, custom_roles, settings, admin_dashboard
from app.routers.users import internal_router

logger = get_logger(__name__)

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if not _allowed_origins:
    raise RuntimeError(
        "ALLOWED_ORIGINS environment variable is not set or empty. "
        "Set it to a comma-separated list of allowed origins."
    )

app = FastAPI(
    title="Users API",
    version="1.0.0",
    root_path=os.environ.get("ROOT_PATH", ""),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Multi-tenancy: resolve the tenant per request (no-op when TENANCY_MODE=single).
install_tenant_middleware(app)


@app.middleware("http")
async def logging_middleware(request: Request, call_next) -> Response:
    raw_id = request.headers.get("x-correlation-id", "").strip()
    correlation_id = raw_id if raw_id else str(uuid.uuid4())
    correlation_id_var.set(correlation_id)

    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.exception("request.failed", extra={"method": request.method, "path": request.url.path})
        raise exc

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    status = response.status_code
    log_extra = {"method": request.method, "path": request.url.path, "status": status, "duration_ms": duration_ms}
    if status >= 500:
        logger.error("request.error", extra=log_extra)
    elif status >= 400:
        logger.warning("request.client_error", extra=log_extra)
    else:
        logger.info("request.completed", extra=log_extra)

    response.headers["x-correlation-id"] = correlation_id
    return response


app.include_router(users.router, prefix="/v1")
app.include_router(roles.router, prefix="/v1")
app.include_router(permissions.router, prefix="/v1")
app.include_router(iam.router, prefix="/v1")
app.include_router(custom_roles.router, prefix="/v1")
app.include_router(settings.router, prefix="/v1")
app.include_router(admin_dashboard.router, prefix="/v1")
app.include_router(internal_router)


@app.get("/health")
async def health() -> Response:
    return JSONResponse({"status": "ok"})
