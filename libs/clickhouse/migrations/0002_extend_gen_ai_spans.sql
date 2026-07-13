-- Extend the gen_ai_spans table with span-level OTel fields and a flexible
-- attributes map. Background:
--   * parent_span_id is needed to reconstruct execution graphs (parent/child)
--   * span_name / span_kind / status_* are universal OTel span fields, set by
--     every instrumentation library — safe as dedicated columns
--   * attributes (Map) holds every span attribute verbatim, so we no longer
--     drop data from libraries that don't follow OTel GenAI semantic
--     conventions (e.g. LangChain via OpenInference uses llm.* / openinference.*)

ALTER TABLE otel.gen_ai_spans
    ADD COLUMN IF NOT EXISTS parent_span_id  String,
    ADD COLUMN IF NOT EXISTS span_name       String,
    ADD COLUMN IF NOT EXISTS span_kind       UInt8,
    ADD COLUMN IF NOT EXISTS status_code     UInt8,
    ADD COLUMN IF NOT EXISTS status_message  String,
    ADD COLUMN IF NOT EXISTS attributes      Map(String, String);
