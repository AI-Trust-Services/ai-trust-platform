import json
import os
import re
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from ai_trust_logging import correlation_id_var, get_logger
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.cognee_client import (
    _AI_DEPLOYMENT_ENDPOINT,
    _AI_RESOURCE_GROUP,
    _AI_API_VERSION,
    _sap_ai_configured,
    get_sap_token,
    setup_sap_ai_core,
)
from app.database import init_db
from app.routers import graph, ingest

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
    sap_configured = await setup_sap_ai_core()
    if sap_configured:
        logger.info("startup.sap_ai_core_configured")
    else:
        logger.info("startup.sap_ai_core_skipped", extra={"reason": "credentials absent"})
    yield


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


@app.get("/health")
async def health() -> Response:
    pdf_path = os.environ.get("EU_AI_ACT_PDF_PATH", "/data/EU-AI-ACT.pdf")
    pdf_ok = os.path.exists(pdf_path)
    return JSONResponse({
        "status": "ok",
        "pdf_mounted": pdf_ok,
        "pdf_path": pdf_path,
    })


# ---------------------------------------------------------------------------
# SAP AI Core adapter — OpenAI-compatible endpoint used by cognee internally.
# Translates /v1/chat/completions (OpenAI format) → {deployment}/invoke
# (AWS Bedrock/Anthropic format) → OpenAI response shape.
# Only registered when SAP AI Core credentials are present.
# ---------------------------------------------------------------------------

@app.post("/internal/v1/chat/completions")
async def sap_ai_core_adapter(request: Request) -> JSONResponse:
    if not _sap_ai_configured():
        raise HTTPException(status_code=503, detail="SAP AI Core not configured")

    body = await request.json()
    messages: list[dict] = body.get("messages", [])
    max_tokens: int = body.get("max_tokens", 8192)
    response_format = body.get("response_format")

    # Separate system messages; Anthropic /invoke takes them as a top-level field.
    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    convo = [m for m in messages if m["role"] != "system"]
    # Anthropic requires the conversation to start and end with a user turn.
    while convo and convo[0]["role"] != "user":
        convo = convo[1:]
    while convo and convo[-1]["role"] != "user":
        convo = convo[:-1]
    if not convo:
        convo = [{"role": "user", "content": "(start)"}]

    # If the caller asks for JSON output, add schema instructions so Claude uses
    # the exact field names cognee's Pydantic models expect.
    if response_format and response_format.get("type") == "json_object":
        schema_hint = (
            "\n\nRespond with valid JSON only. No markdown fences."
            " For knowledge graph nodes use exactly: id (string), name (string), description (string), type (string)."
            " For edges use exactly: source_node_id (string), target_node_id (string), relationship_name (string)."
            " Do NOT use: source, target, type (for edges), from, to."
            " Every node MUST have a description field."
        )
        convo[-1]["content"] = str(convo[-1]["content"]) + schema_hint

    invoke_body: dict = {
        "anthropic_version": _AI_API_VERSION,
        "max_tokens": max_tokens,
        "messages": convo,
    }
    if system_parts:
        invoke_body["system"] = "\n\n".join(system_parts)

    token = await get_sap_token()
    invoke_url = _AI_DEPLOYMENT_ENDPOINT.rstrip("/") + "/invoke"

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            invoke_url,
            json=invoke_body,
            headers={
                "Authorization": f"Bearer {token}",
                "AI-Resource-Group": _AI_RESOURCE_GROUP,
                "Content-Type": "application/json",
            },
        )

    if resp.status_code >= 400:
        logger.error(
            "sap_ai_core.upstream_error",
            extra={"status": resp.status_code, "body": resp.text[:300]},
        )
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])

    data = resp.json()
    content_blocks = data.get("content", [])
    text = content_blocks[0].get("text", "") if content_blocks else ""
    usage = data.get("usage", {})

    # Strip markdown fences and remap KnowledgeGraph edge field names so cognee's
    # Pydantic schema validates correctly. Claude uses source/target/type but cognee
    # expects source_node_id/target_node_id/relationship_name.
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "edges" in parsed:
            for edge in parsed["edges"]:
                if "source" in edge and "source_node_id" not in edge:
                    edge["source_node_id"] = edge.pop("source")
                if "target" in edge and "target_node_id" not in edge:
                    edge["target_node_id"] = edge.pop("target")
                if "type" in edge and "relationship_name" not in edge:
                    edge["relationship_name"] = edge.pop("type")
            text = json.dumps(parsed)
    except (json.JSONDecodeError, AttributeError):
        pass

    # Return OpenAI-compatible response shape.
    return JSONResponse({
        "id": data.get("id", "sap-" + str(uuid.uuid4())),
        "object": "chat.completion",
        "model": body.get("model", "sap-ai-core"),
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": text},
            "finish_reason": data.get("stop_reason", "stop"),
        }],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        },
    })
