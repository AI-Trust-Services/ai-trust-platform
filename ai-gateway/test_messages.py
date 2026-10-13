"""Unit tests for the /v1/messages (native Anthropic passthrough) endpoint.

Env vars required by main.py are set before import so the module-level
os.environ[] calls succeed in a test context without a real deployment.
"""

import json
import os

# Set required env vars before importing main (module-level reads).
os.environ.setdefault("AI_CLIENT_ID", "test-client-id")
os.environ.setdefault("AI_CLIENT_SECRET", "test-secret")
os.environ.setdefault("AI_AUTH_URL", "http://test-auth/token")
os.environ.setdefault("AI_API_URL", "http://test-api")
os.environ.setdefault("AI_DEPLOYMENT_ID", "test-deployment")

import main
import pytest
from starlette.testclient import TestClient

# ---------------------------------------------------------------------------
# Minimal httpx.Response stand-in
# ---------------------------------------------------------------------------


class _FakeResponse:
    """Mimics the httpx.Response interface used by the handler."""

    def __init__(self, status_code: int, data: dict) -> None:
        self.status_code = status_code
        self._data = data
        self.text = json.dumps(data)

    def json(self) -> dict:
        # Return a fresh copy so handler mutations don't bleed between tests.
        return json.loads(self.text)


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> TestClient:
    return TestClient(main.app)


# ---------------------------------------------------------------------------
# Test (a) + (b): tools/tool_choice forwarded; tool_use block returned raw
# ---------------------------------------------------------------------------


def test_tools_and_tool_choice_forwarded_and_tool_use_block_returned_unmodified(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """(a) tools + tool_choice land in invoke_body; (b) tool_use block in response is untouched."""
    captured: dict = {}

    canned_upstream = {
        "id": "msg_tool_123",
        "type": "message",
        "role": "assistant",
        "model": "claude-3-5-sonnet-20241022",
        "content": [
            {
                "type": "tool_use",
                "id": "toolu_01abc",
                "name": "get_weather",
                "input": {"location": "Paris", "unit": "celsius"},
            }
        ],
        "stop_reason": "tool_use",
        "usage": {"input_tokens": 60, "output_tokens": 40},
    }

    async def mock_invoke(client_arg, invoke_body):
        captured["invoke_body"] = invoke_body
        return _FakeResponse(200, canned_upstream)

    monkeypatch.setattr(main, "_invoke_with_retry", mock_invoke)

    tools = [
        {
            "name": "get_weather",
            "description": "Retrieve current weather for a city.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                },
                "required": ["location"],
            },
        }
    ]
    tool_choice = {"type": "auto"}

    request_payload = {
        "model": "claude-3-5-sonnet-20241022",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "What's the weather in Paris?"}],
        "tools": tools,
        "tool_choice": tool_choice,
    }

    response = client.post("/v1/messages", json=request_payload)
    assert response.status_code == 200

    # (a) — tools and tool_choice forwarded verbatim
    ib = captured["invoke_body"]
    assert ib["tools"] == tools, "tools must be forwarded as-is"
    assert ib["tool_choice"] == tool_choice, "tool_choice must be forwarded as-is"
    assert ib["messages"] == request_payload["messages"]
    assert ib["max_tokens"] == 1024
    assert ib["anthropic_version"] == main._API_VERSION
    # system absent from request → must NOT appear in invoke_body
    assert "system" not in ib

    # (b) — raw tool_use block returned unmodified
    resp_json = response.json()
    assert resp_json["id"] == "msg_tool_123"
    assert resp_json["stop_reason"] == "tool_use"
    content = resp_json["content"]
    assert len(content) == 1
    block = content[0]
    assert block["type"] == "tool_use"
    assert block["id"] == "toolu_01abc"
    assert block["name"] == "get_weather"
    assert block["input"] == {"location": "Paris", "unit": "celsius"}


# ---------------------------------------------------------------------------
# Test (c): missing type/role defaulted; model falls back to request model
# ---------------------------------------------------------------------------


def test_missing_type_role_and_model_defaulted(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """(c) type, role, and model are injected when the upstream omits them."""
    canned_upstream = {
        "id": "msg_bare_456",
        # type, role, and model intentionally absent
        "content": [{"type": "text", "text": "Hello from upstream."}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 12, "output_tokens": 7},
    }

    async def mock_invoke(client_arg, invoke_body):
        return _FakeResponse(200, canned_upstream)

    monkeypatch.setattr(main, "_invoke_with_retry", mock_invoke)

    request_payload = {
        "model": "my-custom-claude",
        "messages": [{"role": "user", "content": "Hi"}],
    }

    response = client.post("/v1/messages", json=request_payload)
    assert response.status_code == 200

    resp_json = response.json()

    # (c) — defaults injected
    assert resp_json["type"] == "message", "type must default to 'message'"
    assert resp_json["role"] == "assistant", "role must default to 'assistant'"
    assert resp_json["model"] == "my-custom-claude", (
        "model must fall back to request model"
    )

    # Upstream fields preserved as-is
    assert resp_json["id"] == "msg_bare_456"
    assert resp_json["content"] == [{"type": "text", "text": "Hello from upstream."}]
    assert resp_json["stop_reason"] == "end_turn"
    assert resp_json["usage"] == {"input_tokens": 12, "output_tokens": 7}


# ---------------------------------------------------------------------------
# Test (a) extra: system forwarded when present; absent when not
# ---------------------------------------------------------------------------


def test_system_forwarded_only_when_present(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """system is forwarded when present and absent when not (no spurious keys)."""
    captured: dict = {}

    canned_upstream = {
        "id": "msg_sys_789",
        "type": "message",
        "role": "assistant",
        "model": "claude-3-5-sonnet-20241022",
        "content": [{"type": "text", "text": "Sure."}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 20, "output_tokens": 5},
    }

    async def mock_invoke(client_arg, invoke_body):
        captured["invoke_body"] = invoke_body
        return _FakeResponse(200, canned_upstream)

    monkeypatch.setattr(main, "_invoke_with_retry", mock_invoke)

    # With system
    response = client.post(
        "/v1/messages",
        json={
            "model": "claude-3-5-sonnet-20241022",
            "system": "You are a helpful assistant.",
            "messages": [{"role": "user", "content": "Hello"}],
        },
    )
    assert response.status_code == 200
    assert captured["invoke_body"]["system"] == "You are a helpful assistant."
    assert "tools" not in captured["invoke_body"]
    assert "tool_choice" not in captured["invoke_body"]

    # Without system
    captured.clear()
    response = client.post(
        "/v1/messages",
        json={
            "model": "claude-3-5-sonnet-20241022",
            "messages": [{"role": "user", "content": "Hello"}],
        },
    )
    assert response.status_code == 200
    assert "system" not in captured["invoke_body"]
