import asyncio
import logging
import os
from contextlib import asynccontextmanager

import aio_pika
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

RABBITMQ_URL = os.environ["RABBITMQ_URL"]
EXCHANGE_NAME = "otel.traces"

_connection: aio_pika.abc.AbstractRobustConnection | None = None
_exchange: aio_pika.abc.AbstractExchange | None = None

logger = logging.getLogger(__name__)

_CONNECT_RETRIES = int(os.environ.get("RMQ_CONNECT_RETRIES", 10))
_CONNECT_DELAY = float(os.environ.get("RMQ_CONNECT_DELAY", 3.0))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _connection, _exchange
    for attempt in range(1, _CONNECT_RETRIES + 1):
        try:
            _connection = await aio_pika.connect_robust(RABBITMQ_URL)
            if attempt > 1:
                logger.info("RabbitMQ connected on attempt %d/%d", attempt, _CONNECT_RETRIES)
            break
        except Exception as exc:
            if attempt == _CONNECT_RETRIES:
                raise
            logger.warning("RabbitMQ not ready (attempt %d/%d): %s — retrying in %.0fs", attempt, _CONNECT_RETRIES, exc, _CONNECT_DELAY)
            await asyncio.sleep(_CONNECT_DELAY)
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
