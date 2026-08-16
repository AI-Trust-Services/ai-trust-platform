from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from ai_trust_clickhouse import (
    GEN_AI_SPANS,
    current_tenant,
    get_client_for_tenant,
    tenant_clause,
)
from ai_trust_logging import get_logger
from app.summary import build_summary

logger = get_logger(__name__)

router = APIRouter()


@router.get("/traces")
def list_traces(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    trace_id: Optional[str] = Query(default=None),
    service_name: Optional[str] = Query(default=None),
    model: Optional[str] = Query(default=None),
    from_ts: Optional[str] = Query(default=None, alias="from"),
    to_ts: Optional[str] = Query(default=None, alias="to"),
    errors_only: bool = Query(default=False),
):
    # Build a parameterised WHERE — clickhouse-connect substitutes `{name:Type}`
    # placeholders server-side, so user input never gets concatenated into SQL.
    # Manual escaping with chr(39) doubling is *not* safe against backslash
    # escapes that ClickHouse also honours (`\'`).
    conditions: list[str] = []
    params: dict[str, Any] = {}
    if trace_id:
        # Substring match — users typically paste a full ID or a prefix from a log line
        conditions.append("trace_id LIKE {trace_id_like:String}")
        params["trace_id_like"] = f"%{trace_id}%"
    if service_name:
        conditions.append("service_name = {service_name:String}")
        params["service_name"] = service_name
    if model:
        conditions.append("request_model = {model:String}")
        params["model"] = model
    if from_ts:
        conditions.append("started_at >= parseDateTimeBestEffort({from_ts:String})")
        params["from_ts"] = from_ts
    if to_ts:
        conditions.append("started_at <= parseDateTimeBestEffort({to_ts:String})")
        params["to_ts"] = to_ts

    # Tenant scoping — always ANDed in (fail-closed when unresolved).
    tenant_where, tenant_params = tenant_clause()
    params.update(tenant_params)
    conditions.append(tenant_where)

    where = "WHERE " + " AND ".join(conditions)

    # `errors_only` is applied at the aggregation level via HAVING, not as a
    # subquery — keeps the time filter and other conditions on the spans being
    # scanned and avoids a second full-table scan over the whole history.
    having = "HAVING max(status_code) = 2" if errors_only else ""

    query = f"""
        SELECT
            trace_id,
            min(started_at)                                   AS trace_started_at,
            count()                                           AS span_count,
            anyIf(service_name, service_name != '')           AS svc_name,
            -- The trace's root span name — the OTel span without a parent. It's
            -- the most intentional label a trace has (e.g. "agent.session",
            -- "rag.pipeline", "llm.chat"), set by the app and unique per trace.
            anyIf(span_name, parent_span_id = '')             AS root_span_name,
            -- Wall-clock span of the trace in seconds: last span's end minus
            -- first span's start. Computed against millisecond precision so
            -- sub-second traces don't round to 0 under DateTime64 started_at.
            -- duration_ms stays Float64 here — wrapping it in toInt64 would
            -- truncate sub-millisecond spans to 0 and defeat migration 0003.
            round(
                (max(toUnixTimestamp64Milli(started_at) + duration_ms)
                 - min(toUnixTimestamp64Milli(started_at))) / 1000.0,
                3
            )                                                  AS total_duration_s,
            sum(input_tokens + output_tokens)                 AS total_tokens,
            -- anyIf picks the first non-empty value deterministically — `any()`
            -- could land on a child span whose request_model is "" (e.g. a
            -- retrieval span in a RAG trace), which rendered as "—" even when
            -- a sibling LLM span clearly had a model.
            anyIf(request_model, request_model != '')         AS req_model,
            max(status_code) = 2                              AS has_error
        FROM {GEN_AI_SPANS}
        {where}
        GROUP BY trace_id
        {having}
        ORDER BY trace_started_at DESC
        LIMIT {{limit:UInt32}}
        OFFSET {{offset:UInt32}}
    """
    list_params = {**params, "limit": limit, "offset": offset}

    # Count over the same trace-grouped set so HAVING (errors_only) is honoured.
    count_query = f"""
        SELECT count() FROM (
            SELECT trace_id FROM {GEN_AI_SPANS}
            {where}
            GROUP BY trace_id
            {having}
        )
    """

    ch = get_client_for_tenant(current_tenant())
    try:
        rows = ch.query(query, parameters=list_params)
        total_result = ch.query(count_query, parameters=params)
    except Exception:
        logger.exception("traces.list_query_failed")
        raise HTTPException(status_code=503, detail="Data store unavailable")
    total = total_result.result_rows[0][0] if total_result.result_rows else 0

    items = [
        {
            "trace_id": r[0],
            "started_at": r[1].isoformat() if r[1] else None,
            "span_count": r[2],
            "service_name": r[3],
            "root_span_name": r[4] or "",
            "total_duration_s": float(r[5]) if r[5] else 0.0,
            "total_tokens": r[6],
            "request_model": r[7],
            "has_error": bool(r[8]),
        }
        for r in rows.result_rows
    ]
    return JSONResponse({"items": items, "total": total, "limit": limit, "offset": offset})


@router.get("/traces/{trace_id}")
def get_trace(trace_id: str):
    spans = _load_spans(trace_id)
    return JSONResponse({"trace_id": trace_id, "spans": spans})


@router.get("/traces/{trace_id}/summary")
def get_trace_summary(trace_id: str):
    """Decision Summary v1 — deterministic audit-focused trace summary.

    Returns a DecisionRecord (see `app/summary.py`) built from the same spans
    /traces/{trace_id} would return. The two endpoints are independent on
    purpose: the UI loads them in parallel, and exports / CLI clients can
    fetch just the summary without paying for the full span list.
    """
    spans = _load_spans(trace_id)
    if not spans:
        raise HTTPException(status_code=404, detail=f"Trace '{trace_id}' not found")
    record = build_summary(spans)
    # Pydantic .model_dump() — preserve enum values as strings for JSON output.
    return JSONResponse(record.model_dump(mode="json"))


def _load_spans(trace_id: str) -> list[dict[str, Any]]:
    """Fetch all spans for a trace, ordered by `started_at` ASC.

    Extracted so /traces/{id} and /traces/{id}/summary share one query
    surface — both endpoints hit ClickHouse independently (we explicitly
    chose not to cache for v1; if load shows up, a small TTL cache around
    this function is the smallest possible fix).

    `trace_id` flows in from the URL path, so the query MUST use
    clickhouse-connect's server-side `{name:Type}` parameter substitution.
    Manual quote-doubling is not safe — ClickHouse also honours backslash
    escapes (`\\'`), so `'\\'' OR 1=1 --` would break out of the literal.
    """
    tenant_where, tenant_params = tenant_clause()
    query = f"""
        SELECT
            span_id,
            parent_span_id,
            started_at,
            duration_ms,
            operation_name,
            span_name,
            span_kind,
            status_code,
            status_message,
            service_name,
            gen_ai_system,
            request_model,
            response_model,
            input_tokens,
            output_tokens,
            finish_reasons,
            input_messages,
            output_messages,
            attributes
        FROM {GEN_AI_SPANS}
        WHERE trace_id = {{trace_id:String}}
        AND {tenant_where}
        ORDER BY started_at ASC
    """

    ch = get_client_for_tenant(current_tenant())
    try:
        rows = ch.query(query, parameters={"trace_id": trace_id, **tenant_params})
    except Exception:
        logger.exception("traces.load_spans_query_failed", extra={"trace_id": trace_id})
        raise HTTPException(status_code=503, detail="Data store unavailable")

    return [
        {
            "span_id": r[0],
            # Empty string for root spans — keep the field present so the
            # frontend can treat it as nullable rather than missing.
            "parent_span_id": r[1] or "",
            "started_at": r[2].isoformat() if r[2] else None,
            "duration_ms": float(r[3]),
            "operation_name": r[4],
            "span_name": r[5],
            "span_kind": int(r[6]),
            "status_code": int(r[7]),
            "status_message": r[8],
            "service_name": r[9],
            "gen_ai_system": r[10],
            "request_model": r[11],
            "response_model": r[12],
            "input_tokens": r[13],
            "output_tokens": r[14],
            "finish_reasons": r[15],
            "input_messages": r[16],
            "output_messages": r[17],
            # ClickHouse returns Map columns as dicts; pass through verbatim
            # so the frontend can pick whichever keys it needs without us
            # touching the backend each time.
            "attributes": dict(r[18]) if r[18] else {},
        }
        for r in rows.result_rows
    ]
