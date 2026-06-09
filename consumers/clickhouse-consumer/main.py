import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import aio_pika
import clickhouse_connect

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

RABBITMQ_URL = os.environ["RABBITMQ_URL"]
CLICKHOUSE_HOST = os.environ["CLICKHOUSE_HOST"]
CLICKHOUSE_PORT = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_USER = os.environ["CLICKHOUSE_USER"]
CLICKHOUSE_PASSWORD = os.environ["CLICKHOUSE_PASSWORD"]
EXCHANGE_NAME = "otel.traces"


def _extract_attr(attributes: list, key: str) -> str | None:
    for attr in attributes:
        if attr.get("key") == key:
            val = attr.get("value", {})
            if "stringValue" in val:
                return val["stringValue"]
            if "intValue" in val:
                return str(val["intValue"])
            if "doubleValue" in val:
                return str(val["doubleValue"])
            if "boolValue" in val:
                return str(val["boolValue"]).lower()
    return None


def _parse_nano(nano: str | None) -> datetime:
    if not nano:
        return datetime.now(timezone.utc)
    return datetime.fromtimestamp(int(nano) / 1_000_000_000, tz=timezone.utc)


def _process_payload(body: bytes) -> list[dict]:
    payload = json.loads(body)
    rows = []
    for resource_span in payload.get("resourceSpans", []):
        resource_attrs = resource_span.get("resource", {}).get("attributes", [])
        service_name = _extract_attr(resource_attrs, "service.name") or ""
        for scope_span in resource_span.get("scopeSpans", []):
            for span in scope_span.get("spans", []):
                attrs = span.get("attributes", [])
                operation_name = _extract_attr(attrs, "gen_ai.operation.name")
                if not operation_name:
                    continue
                start_nano = span.get("startTimeUnixNano")
                end_nano = span.get("endTimeUnixNano")
                duration_ms = 0.0
                if start_nano and end_nano:
                    duration_ms = (int(end_nano) - int(start_nano)) / 1_000_000
                rows.append({
                    "received_at": datetime.now(timezone.utc),
                    "started_at": _parse_nano(start_nano),
                    "trace_id": span.get("traceId", ""),
                    "span_id": span.get("spanId", ""),
                    "service_name": service_name,
                    "gen_ai_system": _extract_attr(attrs, "gen_ai.system") or "",
                    "operation_name": operation_name,
                    "request_model": _extract_attr(attrs, "gen_ai.request.model") or "",
                    "response_model": _extract_attr(attrs, "gen_ai.response.model") or "",
                    "finish_reasons": _extract_attr(attrs, "gen_ai.response.finish_reasons") or "",
                    "input_tokens": int(_extract_attr(attrs, "gen_ai.usage.input_tokens") or 0),
                    "output_tokens": int(_extract_attr(attrs, "gen_ai.usage.output_tokens") or 0),
                    "max_tokens": int(_extract_attr(attrs, "gen_ai.request.max_tokens") or 0),
                    "duration_ms": duration_ms,
                    "input_messages": _extract_attr(attrs, "gen_ai.input.messages") or "",
                    "output_messages": _extract_attr(attrs, "gen_ai.output.messages") or "",
                })
    return rows


async def main() -> None:
    log.info("Connecting to ClickHouse at %s:%s", CLICKHOUSE_HOST, CLICKHOUSE_PORT)
    ch = clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST,
        port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER,
        password=CLICKHOUSE_PASSWORD,
    )

    log.info("Connecting to RabbitMQ (credentials masked)")
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    exchange = await channel.declare_exchange(EXCHANGE_NAME, aio_pika.ExchangeType.FANOUT, durable=True)
    queue = await channel.declare_queue("clickhouse-consumer", durable=True)
    await queue.bind(exchange)

    log.info("Waiting for messages on exchange %s", EXCHANGE_NAME)

    async with queue.iterator() as messages:
        async for message in messages:
            async with message.process():
                try:
                    rows = _process_payload(message.body)
                    if not rows:
                        continue
                    ch.insert(
                        "otel.gen_ai_spans",
                        [list(r.values()) for r in rows],
                        column_names=list(rows[0].keys()),
                    )
                    log.info("Inserted %d GenAI span(s)", len(rows))
                except Exception:
                    log.exception("Failed to process message")


if __name__ == "__main__":
    asyncio.run(main())
