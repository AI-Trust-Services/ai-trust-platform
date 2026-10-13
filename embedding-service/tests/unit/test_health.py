"""Unit test: /health reports 'loading' until the model is in memory.

Uses TestClient WITHOUT the lifespan context manager, so the (heavy) model load
never runs — we assert only the not-yet-loaded contract.
"""

from fastapi.testclient import TestClient

from app.main import app


def test_health_loading_before_model():
    client = TestClient(app)  # no `with` → lifespan not triggered, model stays None
    resp = client.get("/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "loading"
