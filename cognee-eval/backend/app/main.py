import os
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from ai_trust_logging import correlation_id_var, get_logger
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import init_db
from app.routers import evaluate, feedback, graph, ingest, ui

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
    await init_db()
    logger.info("startup.db_ready")
    await _warm_embedding_model()
    yield


async def _warm_embedding_model() -> None:
    """Pin the Ollama embedding model in memory so the first ingest doesn't time out.

    Ollama takes 20-60s to load nomic-embed-text on a cold start. cognee's
    embedding client has a hardcoded 60s timeout, which can fire before the
    response arrives on the first call after a clean volume. Sending
    keep_alive=-1 at startup keeps the model loaded indefinitely.
    """
    endpoint = os.environ.get("EMBEDDING_ENDPOINT", "")
    model = os.environ.get("EMBEDDING_MODEL", "")
    if not endpoint or not model or "/api/" not in endpoint:
        return
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            await client.post(
                endpoint,
                json={"model": model, "input": ["warmup"], "keep_alive": -1},
            )
        logger.info("startup.embedding_model_warmed", extra={"model": model})
    except Exception as exc:
        logger.warning("startup.embedding_warmup_failed", extra={"error": str(exc)})


app = FastAPI(
    title="Cognee Eval API",
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
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request.failed", extra={"method": request.method, "path": request.url.path}
        )
        raise

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    status = response.status_code
    log_extra = {
        "method": request.method,
        "path": request.url.path,
        "status": status,
        "duration_ms": duration_ms,
    }
    if status >= 500:
        logger.error("request.error", extra=log_extra)
    elif status >= 400:
        logger.warning("request.client_error", extra=log_extra)
    else:
        logger.info("request.completed", extra=log_extra)

    response.headers["x-correlation-id"] = correlation_id
    return response


app.include_router(ingest.router, prefix="/v1")
app.include_router(graph.router, prefix="/v1")
app.include_router(evaluate.router, prefix="/v1")
app.include_router(feedback.router, prefix="/v1")
app.include_router(ui.router)


@app.get("/health")
async def health() -> Response:
    pdf_path = os.environ.get("EU_AI_ACT_PDF_PATH", "/data/EU-AI-ACT.pdf")
    pdf_ok = os.path.exists(pdf_path)
    return JSONResponse(
        {
            "status": "ok",
            "pdf_mounted": pdf_ok,
            "pdf_path": pdf_path,
        }
    )
