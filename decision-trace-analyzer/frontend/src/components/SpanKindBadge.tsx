import { classifySpan, type SpanKind } from "../lib/spanAttributes";

interface Props {
  span: { operation_name: string; span_name: string; attributes?: Record<string, string> };
  /** Render a compact pill variant suitable for inline placement next to a span name. */
  size?: "sm" | "md";
}

const LABELS: Record<SpanKind, string> = {
  tool: "TOOL",
  llm: "LLM",
  agent: "AGENT",
  chain: "CHAIN",
  retriever: "RETRIEVER",
  embedding: "EMBED",
  reranker: "RERANK",
  guardrail: "GUARDRAIL",
  other: "",
};

const COLORS: Record<SpanKind, { bg: string; fg: string }> = {
  tool:      { bg: "rgba(76, 175, 80, 0.15)",  fg: "#2e7d32" },   // green
  llm:       { bg: "rgba(33, 150, 243, 0.15)", fg: "#1565c0" },   // blue
  agent:     { bg: "rgba(156, 39, 176, 0.15)", fg: "#6a1b9a" },   // purple
  chain:     { bg: "rgba(255, 152, 0, 0.15)",  fg: "#e65100" },   // orange
  retriever: { bg: "rgba(0, 188, 212, 0.15)",  fg: "#00838f" },   // cyan
  embedding: { bg: "rgba(63, 81, 181, 0.15)",  fg: "#283593" },   // indigo
  reranker:  { bg: "rgba(121, 85, 72, 0.15)",  fg: "#4e342e" },   // brown
  guardrail: { bg: "rgba(244, 67, 54, 0.15)",  fg: "#c62828" },   // red
  other:     { bg: "transparent",              fg: "transparent" },
};

/**
 * Small coloured pill that classifies a span as LLM / TOOL / AGENT / CHAIN.
 * Renders nothing for "other" so unclassified spans stay visually quiet.
 */
export function SpanKindBadge({ span, size = "sm" }: Props) {
  const kind = classifySpan(span as Parameters<typeof classifySpan>[0]);
  if (kind === "other") return null;
  const c = COLORS[kind];
  const styles: React.CSSProperties = {
    display: "inline-block",
    padding: size === "sm" ? "1px 6px" : "2px 8px",
    borderRadius: 4,
    background: c.bg,
    color: c.fg,
    fontSize: size === "sm" ? 10 : 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    lineHeight: 1.4,
    verticalAlign: "middle",
  };
  return <span style={styles}>{LABELS[kind]}</span>;
}
