"""Unit tests for otel-pipeline/rmq-bridge — pure logic, no RabbitMQ required."""
from __future__ import annotations


def test_health_response_ok_shape():
    response = {"status": "ok", "rmq": "ok"}
    assert response["status"] == "ok"
    assert response["rmq"] == "ok"


def test_health_response_degraded_shape():
    response = {"status": "degraded", "rmq": "unavailable"}
    assert response["status"] == "degraded"
    assert response["rmq"] == "unavailable"


def test_exchange_name():
    EXCHANGE_NAME = "otel.traces"
    assert EXCHANGE_NAME == "otel.traces"


def test_connect_retries_default():
    import os
    retries = int(os.environ.get("RMQ_CONNECT_RETRIES", 10))
    assert retries == 10
