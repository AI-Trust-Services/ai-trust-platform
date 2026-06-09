import os
from contextlib import asynccontextmanager

import aio_pika
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

RABBITMQ_URL = os.environ["RABBITMQ_URL"]
EXCHANGE_NAME = "otel.traces"

_connection: aio_pika.abc.AbstractRobustConnection | None = None
_exchange: aio_pika.abc.AbstractExchange | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _connection, _exchange
    _connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await _connection.channel()
    _exchange = await channel.declare_exchange(EXCHANGE_NAME, aio_pika.ExchangeType.FANOUT, durable=True)
    yield
    await _connection.close()


app = FastAPI(title="OTel RMQ Bridge", version="1.0.0", lifespan=lifespan)


@app.post("/v1/traces")
async def ingest_traces(request: Request) -> Response:
    if _exchange is None:
        return JSONResponse({"status": "degraded", "rmq": "unavailable"}, status_code=503)
    body = await request.body()
    await _exchange.publish(
        aio_pika.Message(body=body, content_type="application/json"),
        routing_key="",
    )
    return JSONResponse({"partialSuccess": {}})


@app.get("/health")
async def health() -> Response:
    if _connection is None or _connection.is_closed:
        return JSONResponse({"status": "degraded", "rmq": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ok", "rmq": "ok"})
