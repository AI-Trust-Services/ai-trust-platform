"""SAP AI Core OpenAI-compatible proxy.

Presents a standard OpenAI /v1/chat/completions endpoint so any litellm-based
client (e.g. cognee) can use it unmodified, and translates to the Anthropic
bedrock /invoke format the AI Core deployment (claude-*) actually accepts.
Handles OAuth2 client-credentials token refresh transparently.
"""

import asyncio
import json
import logging
import os
import random
import re
import time
import uuid

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("sap-ai-proxy")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="SAP AI Core Proxy", version="1.0.0")

# ── config from env ──────────────────────────────────────────────────────────
_CLIENT_ID = os.environ["AI_CLIENT_ID"]
_CLIENT_SECRET = os.environ["AI_CLIENT_SECRET"]
_AUTH_URL = os.environ["AI_AUTH_URL"]
_API_URL = os.environ["AI_API_URL"]
_RESOURCE_GROUP = os.environ.get("AI_RESOURCE_GROUP", "default")
_DEPLOYMENT_ID = os.environ["AI_DEPLOYMENT_ID"]
_API_VERSION = os.environ.get("AI_API_VERSION", "bedrock-2023-05-31")

_INVOKE_URL = f"{_API_URL.rstrip('/')}/v2/inference/deployments/{_DEPLOYMENT_ID}/invoke"

# Retry on SAP throttling / transient upstream errors.
_RETRY_STATUSES = {429, 500, 502, 503, 529}
_MAX_RETRIES = int(os.environ.get("SAP_PROXY_MAX_RETRIES", "6"))

# ── token cache ──────────────────────────────────────────────────────────────
_token: str | None = None
_token_expires_at: float = 0.0
_token_lock = asyncio.Lock()


async def _get_token(client: httpx.AsyncClient) -> str:
    global _token, _token_expires_at
    now = time.time()
    if _token and now < _token_expires_at - 60:
        return _token
    async with _token_lock:
        now = time.time()
        if _token and now < _token_expires_at - 60:
            return _token
        logger.info("Fetching new SAP AI Core OAuth token")
        resp = await client.post(
            _AUTH_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": _CLIENT_ID,
                "client_secret": _CLIENT_SECRET,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        _token = data["access_token"]
        _token_expires_at = now + int(data.get("expires_in", 3600))
        logger.info("Token obtained, expires in %ss", data.get("expires_in", 3600))
        return _token


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


async def _invoke_with_retry(
    client: httpx.AsyncClient, invoke_body: dict
) -> httpx.Response:
    """POST to SAP /invoke, retrying 429/5xx with exponential backoff + Retry-After."""
    last: httpx.Response | None = None
    for attempt in range(_MAX_RETRIES + 1):
        token = await _get_token(client)
        resp = await client.post(
            _INVOKE_URL,
            json=invoke_body,
            headers={
                "Authorization": f"Bearer {token}",
                "AI-Resource-Group": _RESOURCE_GROUP,
                "Content-Type": "application/json",
            },
        )
        if resp.status_code not in _RETRY_STATUSES:
            return resp
        last = resp
        if attempt == _MAX_RETRIES:
            break
        # Honor Retry-After when present, else exponential backoff with jitter.
        retry_after = resp.headers.get("retry-after")
        if retry_after and retry_after.isdigit():
            delay = float(retry_after)
        else:
            delay = min(2.0**attempt + random.uniform(0, 1), 30.0)
        logger.warning(
            "Upstream %s — retry %d/%d in %.1fs",
            resp.status_code,
            attempt + 1,
            _MAX_RETRIES,
            delay,
        )
        await asyncio.sleep(delay)
    return last  # type: ignore[return-value]


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> JSONResponse:
    """OpenAI chat/completions → Anthropic /invoke → OpenAI response shape."""
    body = await request.json()
    messages: list[dict] = body.get("messages", [])
    max_tokens: int = body.get("max_tokens", 8192)
    response_format = body.get("response_format")

    # Anthropic /invoke takes system messages as a top-level field.
    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    convo = [m for m in messages if m["role"] != "system"]
    # Anthropic requires the conversation to start and end with a user turn.
    while convo and convo[0]["role"] != "user":
        convo = convo[1:]
    while convo and convo[-1]["role"] != "user":
        convo = convo[:-1]
    if not convo:
        convo = [{"role": "user", "content": "(start)"}]

    # When the caller wants JSON, steer the model to cognee's KnowledgeGraph field names.
    if response_format and response_format.get("type") == "json_object":
        schema_hint = (
            "\n\nRespond with valid JSON only. No markdown fences."
            " For knowledge graph nodes use exactly: id (string), name (string),"
            " description (string), type (string). For edges use exactly:"
            " source_node_id (string), target_node_id (string), relationship_name (string)."
            " Do NOT use: source, target, type (for edges), from, to."
            " Every node MUST have a description field."
        )
        convo[-1]["content"] = str(convo[-1]["content"]) + schema_hint

    invoke_body: dict = {
        "anthropic_version": _API_VERSION,
        "max_tokens": max_tokens,
        "messages": convo,
    }
    if system_parts:
        invoke_body["system"] = "\n\n".join(system_parts)

    async with httpx.AsyncClient(timeout=600) as client:
        try:
            resp = await _invoke_with_retry(client, invoke_body)
        except httpx.TimeoutException as e:
            raise HTTPException(status_code=504, detail=f"Upstream timeout: {e}") from e

    if resp.status_code >= 400:
        logger.error("Upstream error %s: %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])

    data = resp.json()
    content_blocks = data.get("content", [])
    text = content_blocks[0].get("text", "") if content_blocks else ""
    usage = data.get("usage", {})

    # Strip markdown fences and remap edge field names so cognee's Pydantic
    # KnowledgeGraph schema validates (Claude tends to emit source/target/type).
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

    return JSONResponse(
        {
            "id": data.get("id", "sap-" + str(uuid.uuid4())),
            "object": "chat.completion",
            "model": body.get("model", "sap-ai-core"),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": data.get("stop_reason", "stop"),
                }
            ],
            "usage": {
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("input_tokens", 0)
                + usage.get("output_tokens", 0),
            },
        }
    )


# ── models endpoint — cognee/litellm may probe this ─────────────────────────
@app.get("/v1/models")
async def list_models() -> dict:
    return {
        "object": "list",
        "data": [
            {"id": "sap-ai-core", "object": "model", "created": 0, "owned_by": "sap"},
        ],
    }
