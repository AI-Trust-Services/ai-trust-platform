import os
import time
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ai_trust_logging import correlation_id_var, get_logger
from ai_trust_persistence import SessionLocal
from app.routers import intake, systems, model_cards

app = FastAPI(title="AI System Registry", version="1.0.0", root_path=os.environ.get("ROOT_PATH", ""))
logger = get_logger(__name__)

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if not _allowed_origins:
    raise RuntimeError(
        "ALLOWED_ORIGINS environment variable is not set or empty. "
        "Set it to a comma-separated list of allowed origins, "
        "e.g. ALLOWED_ORIGINS=http://localhost:3001,http://localhost:8080"
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def logging_middleware(request: Request, call_next) -> Response:
    raw_id = request.headers.get("x-correlation-id", "").strip()
    correlation_id = raw_id if raw_id else str(uuid.uuid4())
    correlation_id_var.set(correlation_id)

    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.exception("request.failed", extra={
            "method": request.method,
            "path": request.url.path,
        })
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


app.include_router(intake.router, prefix="/v1")
app.include_router(systems.router, prefix="/v1")
app.include_router(model_cards.router, prefix="/v1")


@app.get("/health")
async def health() -> Response:
    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return JSONResponse({"status": "ok", "db": "ok"})
    except Exception as e:
        logger.error("health.db_unavailable", extra={"error": str(e)})
        return JSONResponse({"status": "degraded", "db": "unavailable"}, status_code=503)
