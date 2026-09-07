# Table names are UNQUALIFIED (no database prefix) so they resolve against the connection's
# database — which is the tenant's own database (tenant_<org>) on the per-tenant clients, or the
# legacy 'otel' database on a plain client. This is what makes database-per-tenant isolation work
# without rewriting every query. (Provisioning/migrations create these tables in each tenant db.)
GEN_AI_SPANS = "gen_ai_spans"
ALERT_EVENTS = "alert_events"

# Order matters: must match the on-disk column order in ClickHouse. ALTER ADD
# COLUMN appends at the end, so columns from 0002+ are listed after the
# original 0001 columns.
COLUMNS = [
    "received_at",
    "started_at",
    "trace_id",
    "span_id",
    "service_name",
    "gen_ai_system",
    "operation_name",
    "request_model",
    "response_model",
    "finish_reasons",
    "input_tokens",
    "output_tokens",
    "max_tokens",
    "duration_ms",
    "input_messages",
    "output_messages",
    # added in 0002
    "parent_span_id",
    "span_name",
    "span_kind",
    "status_code",
    "status_message",
    "attributes",
]
