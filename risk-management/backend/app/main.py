from __future__ import annotations

import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ai_trust_logging import correlation_id_var, get_logger
from ai_trust_persistence import SessionLocal
from app.routers import registers, risks, triggers

logger = get_logger(__name__)

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if not _allowed_origins:
    raise RuntimeError(
        "ALLOWED_ORIGINS environment variable is not set or empty. "
        "Set it to a comma-separated list of allowed origins."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="Risk Management API",
    version="1.0.0",
    lifespan=lifespan,
    root_path=os.environ.get("ROOT_PATH", ""),
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
    response: Response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    level = "info" if response.status_code < 400 else ("warning" if response.status_code < 500 else "error")
    getattr(logger, level)(
        "http.request",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": round(duration_ms, 1),
            "correlation_id": correlation_id,
        },
    )
    response.headers["X-Correlation-ID"] = correlation_id
    return response


@app.get("/health")
async def health():
    async with SessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok"}


app.include_router(registers.router, prefix="/v1")
app.include_router(risks.router, prefix="/v1")
app.include_router(triggers.router, prefix="/v1")
