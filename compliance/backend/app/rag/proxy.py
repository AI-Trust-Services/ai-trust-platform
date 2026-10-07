"""OpenAI /chat/completions → platform external provider Anthropic /invoke shim.

PageIndex (via LiteLLM) speaks OpenAI POST /v1/chat/completions.
The platform's external LLM provider speaks Anthropic POST /invoke
(same endpoint as ai-system-registry's external provider).

Start with proxy.start() → returns the base_url PageIndex/LiteLLM expects.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx

from . import config

_token: str = ""
_token_expiry: float = 0.0
_token_lock = threading.Lock()


def _get_token() -> str:
    global _token, _token_expiry
    with _token_lock:
        if _token and time.monotonic() < _token_expiry - 60:
            return _token
        r = httpx.post(
            config.AI_AUTH_URL,
            data={"grant_type": "client_credentials"},
            auth=(config.AI_CLIENT_ID, config.AI_CLIENT_SECRET),
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        _token = data["access_token"]
        _token_expiry = time.monotonic() + data.get("expires_in", 43200)
        return _token


def _oai_to_ant(oai: dict) -> dict:
    """Build the full Anthropic /invoke body from an OpenAI chat/completions request."""
    system_parts: list[str] = []
    convo: list[dict] = []

    for m in oai.get("messages", []):
        role = m.get("role")
        content = m.get("content")

        if role == "system":
            if isinstance(content, str):
                system_parts.append(content)
            elif isinstance(content, list):
                system_parts.extend(
                    b.get("text", "") for b in content if b.get("type") == "text"
                )

        elif role == "tool":
            block = {
                "type": "tool_result",
                "tool_use_id": m.get("tool_call_id", ""),
                "content": content or "",
            }
            if convo and convo[-1]["role"] == "user" and isinstance(
                convo[-1]["content"], list
            ):
                convo[-1]["content"].append(block)
            else:
                convo.append({"role": "user", "content": [block]})

        elif role == "assistant":
            tool_calls = m.get("tool_calls") or []
            if tool_calls:
                ant_content: list[dict] = []
                if content:
                    ant_content.append({"type": "text", "text": content})
                for tc in tool_calls:
                    func = tc.get("function", {})
                    try:
                        inp = json.loads(func.get("arguments") or "{}")
                    except (json.JSONDecodeError, TypeError):
                        inp = {}
                    ant_content.append(
                        {
                            "type": "tool_use",
                            "id": tc.get("id", "call_0"),
                            "name": func.get("name", ""),
                            "input": inp,
                        }
                    )
                convo.append({"role": "assistant", "content": ant_content})
            else:
                convo.append({"role": "assistant", "content": content or ""})

        else:  # user
            if isinstance(content, list):
                text = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
                convo.append({"role": "user", "content": text})
            else:
                convo.append({"role": "user", "content": content or ""})

    while convo and convo[0]["role"] != "user":
        convo = convo[1:]
    while convo and convo[-1]["role"] != "user":
        convo = convo[:-1]
    if not convo:
        convo = [{"role": "user", "content": "(start)"}]

    body: dict = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": oai.get("max_tokens") or 4096,
        "messages": convo,
    }
    if system_parts:
        body["system"] = "\n\n".join(system_parts)

    oai_tools = oai.get("tools") or []
    if oai_tools:
        body["tools"] = [
            {
                "name": t["function"]["name"],
                "description": t["function"].get("description", ""),
                "input_schema": t["function"].get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            }
            for t in oai_tools
            if t.get("type") == "function"
        ]

    return body


def _ant_to_oai(data: dict, model: str) -> dict:
    """Convert an Anthropic /invoke response to OpenAI chat/completions shape."""
    content_blocks = data.get("content") or []
    usage = data.get("usage", {})
    stop_reason = data.get("stop_reason", "end_turn")

    texts = [b.get("text", "") for b in content_blocks if b.get("type") == "text"]
    tool_uses = [b for b in content_blocks if b.get("type") == "tool_use"]

    if tool_uses:
        finish_reason = "tool_calls"
        message: dict = {
            "role": "assistant",
            "content": "".join(texts) or None,
            "tool_calls": [
                {
                    "id": tb["id"],
                    "type": "function",
                    "function": {
                        "name": tb["name"],
                        "arguments": json.dumps(tb.get("input", {})),
                    },
                }
                for tb in tool_uses
            ],
        }
    else:
        finish_reason = "stop" if stop_reason in ("end_turn", "stop_sequence") else stop_reason
        message = {"role": "assistant", "content": "".join(texts)}

    return {
        "id": "chatcmpl-rag",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        },
    }


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        oai = json.loads(self.rfile.read(length))

        ant_body = _oai_to_ant(oai)
        invoke_url = (
            f"{config.AI_API_URL}/v2/inference/deployments/{config.AI_DEPLOYMENT_ID}/invoke"
        )
        r = httpx.post(
            invoke_url,
            headers={
                "Authorization": f"Bearer {_get_token()}",
                "AI-Resource-Group": config.AI_RESOURCE_GROUP,
            },
            json=ant_body,
            timeout=120,
        )
        r.raise_for_status()

        resp = _ant_to_oai(r.json(), oai.get("model", "claude"))
        body_bytes = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)


_started: bool = False
_port: int = 11436


def start(port: int = 11436) -> str:
    """Start proxy on a daemon thread (idempotent). Returns the base_url."""
    global _started, _port
    if _started:
        return f"http://127.0.0.1:{_port}/v1"
    _port = port
    server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    _started = True
    return f"http://127.0.0.1:{port}/v1"
