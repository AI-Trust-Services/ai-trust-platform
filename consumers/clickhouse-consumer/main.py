import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Callable

import aio_pika
from ai_trust_clickhouse import COLUMNS, GEN_AI_SPANS, get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


class Batcher:
    def __init__(self, batch_size: int, flush_fn: Callable):
        self._batch_size = batch_size
        self._flush_fn = flush_fn
        self._buffer: list[tuple[list[dict], object]] = []
        self._lock = asyncio.Lock()

    async def add(self, rows: list[dict], message) -> None:
        if not rows:
            return
        async with self._lock:
            self._buffer.append((rows, message))
            if sum(len(r) for r, _ in self._buffer) >= self._batch_size:
                await self._flush_locked()

    async def flush(self) -> None:
        async with self._lock:
            await self._flush_locked()

    async def start_timer(self, interval: float) -> None:
        while True:
            await asyncio.sleep(interval)
            await self.flush()

    async def _flush_locked(self) -> None:
        if not self._buffer:
            return
        snapshot = self._buffer
        all_rows = [row for rows, _ in snapshot for row in rows]
        messages = [msg for _, msg in snapshot]
        await self._flush_fn(all_rows, messages)
        self._buffer = []

EXCHANGE_NAME = "otel.traces"
QUEUE_NAME = "clickhouse-consumer"
_RETRY_DELAYS = [1, 2, 4]


def _extract_attr(attributes: dict, key: str) -> str | None:
    val = attributes.get(key, {})
    if "stringValue" in val:
        return val["stringValue"]
    if "intValue" in val:
        return str(val["intValue"])
    if "doubleValue" in val:
        return str(val["doubleValue"])
    if "boolValue" in val:
        return str(val["boolValue"]).lower()
    if "arrayValue" in val:
        # OTel GenAI semconv defines several attributes as string[] — most
        # importantly `gen_ai.response.finish_reasons`. OTLP wraps each item
        # as a typed AnyValue. Flatten scalars to their string form and emit
        # a JSON array so downstream readers can JSON.parse it (and the
        # existing `[,\s]+`-based finish_reason parser still works on the
        # bracketed form).
        items = val["arrayValue"].get("values") or []
        flat: list[str] = []
        for item in items:
            if "stringValue" in item:
                flat.append(item["stringValue"])
            elif "intValue" in item:
                flat.append(str(item["intValue"]))
            elif "doubleValue" in item:
                flat.append(str(item["doubleValue"]))
            elif "boolValue" in item:
                flat.append(str(item["boolValue"]).lower())
        return json.dumps(flat)
    return None


def _value_to_string(val: dict) -> str:
    """Flatten an OTLP AnyValue into a plain string for the attributes map.

    OTLP encodes every attribute value as a typed wrapper ({"stringValue": ...},
    {"intValue": ...}, etc.). For our generic Map(String, String) column we
    don't care about the original type — we just need something searchable and
    displayable. Arrays and KVLists are JSON-encoded so nothing is silently lost.
    """
    if "stringValue" in val:
        return val["stringValue"]
    if "intValue" in val:
        return str(val["intValue"])
    if "doubleValue" in val:
        return str(val["doubleValue"])
    if "boolValue" in val:
        return str(val["boolValue"]).lower()
    if "arrayValue" in val or "kvlistValue" in val or "bytesValue" in val:
        return json.dumps(val)
    return ""


def _attrs_dict(attributes: list) -> dict:
    return {a["key"]: a.get("value", {}) for a in attributes if "key" in a}


def _attrs_as_map(attrs: dict) -> dict[str, str]:
    """Convert the typed-value attrs dict into a plain {str: str} map for ClickHouse."""
    return {k: _value_to_string(v) for k, v in attrs.items()}


def _parse_nano(nano: str | int | None) -> datetime | None:
    """Decode an OTLP nano-second wall-clock value to a UTC datetime.

    Returns None when the field is missing or unparseable — the caller is
    expected to drop the span. Falling back to `datetime.now()` here would
    silently reorder a buggy span to the end of the trace, hiding the
    instrumentation problem and breaking decision-path ordering downstream.
    """
    if nano is None or nano == "":
        return None
    try:
        return datetime.fromtimestamp(int(nano) / 1_000_000_000, tz=timezone.utc)
    except (TypeError, ValueError):
        return None


def _process_payload(body: bytes) -> list[dict]:
    payload = json.loads(body)
    received_at = datetime.now(timezone.utc)
    rows = []
    for resource_span in payload.get("resourceSpans", []):
        resource_attrs = _attrs_dict(resource_span.get("resource", {}).get("attributes", []))
        service_name = _extract_attr(resource_attrs, "service.name") or ""
        for scope_span in resource_span.get("scopeSpans", []):
            for span in scope_span.get("spans", []):
                attrs = _attrs_dict(span.get("attributes", []))
                # Keep a span if EITHER convention identifies it as GenAI:
                #   * OTel GenAI semconv  → gen_ai.operation.name
                #   * OpenInference (LangChain auto-instrumentation) → openinference.span.kind
                # Pure-infra spans (HTTP/DB clients) still get filtered out.
                operation_name = _extract_attr(attrs, "gen_ai.operation.name")
                openinference_kind = _extract_attr(attrs, "openinference.span.kind")
                if not operation_name and not openinference_kind:
                    continue
                start_nano = span.get("startTimeUnixNano")
                end_nano = span.get("endTimeUnixNano")
                started_at = _parse_nano(start_nano)
                if started_at is None:
                    # Drop spans without a usable wall-clock start — keeping
                    # them with a synthetic "now" timestamp silently reorders
                    # the trace and hides the instrumentation gap.
                    log.warning(
                        "Dropping span %s/%s: missing or invalid startTimeUnixNano=%r",
                        span.get("traceId"), span.get("spanId"), start_nano,
                    )
                    continue
                duration_ms = 0.0
                if start_nano and end_nano:
                    try:
                        duration_ms = (int(end_nano) - int(start_nano)) / 1_000_000
                    except (TypeError, ValueError):
                        duration_ms = 0.0
                status = span.get("status") or {}
                rows.append({
                    "received_at": received_at,
                    "started_at": started_at,
                    "trace_id": span.get("traceId", ""),
                    "span_id": span.get("spanId", ""),
                    "service_name": service_name,
                    "gen_ai_system": _extract_attr(attrs, "gen_ai.system") or "",
                    "operation_name": operation_name or "",
                    "request_model": _extract_attr(attrs, "gen_ai.request.model") or "",
                    "response_model": _extract_attr(attrs, "gen_ai.response.model") or "",
                    "finish_reasons": _extract_attr(attrs, "gen_ai.response.finish_reasons") or "",
                    "input_tokens": int(_extract_attr(attrs, "gen_ai.usage.input_tokens") or 0),
                    "output_tokens": int(_extract_attr(attrs, "gen_ai.usage.output_tokens") or 0),
                    "max_tokens": int(_extract_attr(attrs, "gen_ai.request.max_tokens") or 0),
                    "duration_ms": duration_ms,
                    "input_messages": _extract_attr(attrs, "gen_ai.input.messages") or "",
                    "output_messages": _extract_attr(attrs, "gen_ai.output.messages") or "",
                    # added in 0002 — order must match COLUMNS in tables.py
                    "parent_span_id": span.get("parentSpanId", ""),
                    "span_name": span.get("name", ""),
                    "span_kind": int(span.get("kind", 0)),
                    "status_code": int(status.get("code", 0)),
                    "status_message": status.get("message", "") or "",
                    "attributes": _attrs_as_map(attrs),
                })
    return rows


def make_flush_fn(insert_fn: Callable, retry_delays: list[int] | None = None):
    delays = retry_delays if retry_delays is not None else _RETRY_DELAYS

    async def flush_fn(rows: list[dict], messages: list) -> None:
        for attempt, delay in enumerate([0] + delays, start=1):
            if delay:
                await asyncio.sleep(delay)
            try:
                insert_fn(rows)
                log.info("Inserted %d GenAI span(s) in batch of %d messages", len(rows), len(messages))
                for m in messages:
                    await m.ack()
                return
            except Exception:
                log.warning("ClickHouse insert attempt %d/%d failed", attempt, len(delays) + 1, exc_info=True)
        log.error("Dropping batch of %d rows after %d failed attempts", len(rows), len(delays) + 1)
        for m in messages:
            await m.ack()

    return flush_fn


async def main() -> None:
    rabbitmq_url = os.environ["RABBITMQ_URL"]
    batch_size = int(os.environ.get("BATCH_SIZE", "100"))
    batch_timeout = float(os.environ.get("BATCH_TIMEOUT", "5"))
    ch = get_client()

    batcher = Batcher(
        batch_size=batch_size,
        flush_fn=make_flush_fn(
            lambda rows: ch.insert(GEN_AI_SPANS, [list(r.values()) for r in rows], column_names=COLUMNS)
        ),
    )

    log.info("Connecting to RabbitMQ (credentials masked)")
    connection = await aio_pika.connect_robust(rabbitmq_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=batch_size)
    exchange = await channel.declare_exchange(EXCHANGE_NAME, aio_pika.ExchangeType.FANOUT, durable=True)
    queue = await channel.declare_queue(QUEUE_NAME, durable=True)
    await queue.bind(exchange)

    log.info("Waiting for messages (batch_size=%d, batch_timeout=%ss)", batch_size, batch_timeout)

    timer_task = asyncio.create_task(batcher.start_timer(batch_timeout))
    try:
        async with queue.iterator() as messages:
            async for message in messages:
                try:
                    rows = _process_payload(message.body)
                    await batcher.add(rows, message)
                except Exception:
                    log.exception("Failed to process message — acking and skipping")
                    await message.ack()
    finally:
        timer_task.cancel()
        await batcher.flush()


if __name__ == "__main__":
    asyncio.run(main())
