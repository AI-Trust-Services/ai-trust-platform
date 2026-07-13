import { type SpanKind } from "./spanAttributes";

/**
 * Single source of truth for span-kind colours. Used by SpanGraph,
 * ConversationGraph and Timeline so a "retriever" looks like a retriever
 * everywhere. Hex colours are picked from the Material-ish palette we
 * already use for badges — saturated for borders/strokes, washed-out for
 * fills so node content stays readable.
 */
export interface KindStyle {
  /** Stroke / border colour. */
  border: string;
  /** 10–15% alpha tint used as the node background fill. */
  bg: string;
  /** UI5 icon name shown next to the kind label inside a node header. */
  icon: string;
}

export const KIND_STYLES: Record<SpanKind, KindStyle> = {
  llm:       { border: "#1565c0", bg: "rgba(33, 150, 243, 0.10)", icon: "discussion" },
  tool:      { border: "#2e7d32", bg: "rgba(76, 175, 80, 0.10)",  icon: "wrench" },
  agent:     { border: "#6a1b9a", bg: "rgba(156, 39, 176, 0.10)", icon: "person-placeholder" },
  chain:     { border: "#e65100", bg: "rgba(255, 152, 0, 0.10)",  icon: "chain-link" },
  retriever: { border: "#00838f", bg: "rgba(0, 188, 212, 0.10)",  icon: "search" },
  embedding: { border: "#283593", bg: "rgba(63, 81, 181, 0.10)",  icon: "value-mapping" },
  reranker:  { border: "#4e342e", bg: "rgba(121, 85, 72, 0.10)",  icon: "sort" },
  guardrail: { border: "#c62828", bg: "rgba(244, 67, 54, 0.10)",  icon: "shield" },
  other:     { border: "var(--color-border)", bg: "var(--color-surface)", icon: "process" },
};
