import { Timer, Hash, Sparkles, Server, CircleAlert, type LucideIcon } from "lucide-react";
import { type Span } from "../api/traces";
import { CopyButton } from "./CopyButton";
import { ToolCalls } from "./ToolCalls";
import { SpanKindBadge } from "./SpanKindBadge";
import {
  classifySpan,
  extractToolCalls,
  extractMessages,
  extractGenericIO,
  extractTokens,
  getModelName,
  getSystemName,
} from "../lib/spanAttributes";
import { parseBackendDate } from "../lib/dates";

function StatBar({ span }: { span: Span }) {
  const tokens = extractTokens(span);
  const model = getModelName(span);
  const system = getSystemName(span);

  return (
    <div style={styles.statBar}>
      <StatItem icon={Timer} value={`${span.duration_ms.toFixed(0)}ms`} />
      {tokens && (
        <>
          <div style={styles.statDivider} />
          <StatItem icon={Hash} value={`${tokens.input ?? 0} in`} />
          <StatItem icon={Hash} value={`${tokens.output ?? 0} out`} />
        </>
      )}
      {model && (
        <>
          <div style={styles.statDivider} />
          <StatItem icon={Sparkles} value={model} />
        </>
      )}
      {system && (
        <>
          <div style={styles.statDivider} />
          <StatItem icon={Server} value={system} />
        </>
      )}
    </div>
  );
}

function StatItem({ icon: Icon, value }: { icon: LucideIcon; value: string }) {
  return (
    <div style={styles.statItem}>
      <Icon style={styles.statIcon} />
      <span style={styles.statValue}>{value}</span>
    </div>
  );
}

function MetaGrid({ span }: { span: Span }) {
  const rows: { label: string; value: React.ReactNode; mono?: boolean; copy?: string }[] = [
    { label: "Span ID", value: span.span_id, mono: true, copy: span.span_id },
    ...(span.parent_span_id
      ? [{ label: "Parent", value: span.parent_span_id, mono: true, copy: span.parent_span_id }]
      : []),
    { label: "Started at", value: parseBackendDate(span.started_at).toLocaleString() },
    { label: "Name", value: <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {span.span_name || "—"}
        <SpanKindBadge span={span} />
      </span>
    },
    ...(span.operation_name ? [{ label: "Operation", value: span.operation_name }] : []),
    { label: "Service", value: span.service_name },
    ...(span.finish_reasons ? [{ label: "Finish reason", value: span.finish_reasons }] : []),
  ];

  return (
    <div style={styles.metaGrid}>
      {rows.map(({ label, value, mono, copy }) => (
        <div key={label} style={styles.metaRow}>
          <span style={styles.metaLabel}>{label}</span>
          <span style={{ ...styles.metaValue, ...(mono ? { fontFamily: "monospace", fontSize: "var(--font-size-sm)" } : {}) }}>
            {value}
            {copy && <span style={{ marginLeft: 6 }}><CopyButton value={copy} title={`Copy ${label}`} /></span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusBanner({ span }: { span: Span }) {
  if (span.status_code !== 2) return null;
  return (
    <div style={styles.errorBanner}>
      <CircleAlert style={{ width: 14, height: 14 } as React.CSSProperties} />
      <span style={{ fontWeight: 600 }}>Error</span>
      {span.status_message && <span>· {span.status_message}</span>}
    </div>
  );
}

function MessageBubble({ role, content }: { role: string; content: string }) {
  if (!content) return null;
  return (
    <div style={styles.bubble}>
      <div style={styles.bubbleHeader}>
        <span style={styles.bubbleRole}>{role}</span>
        <CopyButton value={content} title="Copy message" />
      </div>
      <div style={styles.bubbleContent}>{content}</div>
    </div>
  );
}

/** Shown in the assistant slot when input exists but output was never recorded. */
function MissingMessagePlaceholder({ role, hint }: { role: string; hint: string }) {
  return (
    <div style={styles.bubble}>
      <div style={styles.bubbleHeader}>
        <span style={styles.bubbleRole}>{role}</span>
      </div>
      <div style={styles.bubblePlaceholder}>{hint}</div>
    </div>
  );
}

/**
 * Info banner for spans that were emitted but recorded effectively nothing —
 * the instrumentation likely stopped before the model call. Surfaces the gap
 * instead of letting the user wonder why the detail panel is empty.
 */
function InstrumentationGapBanner({ span }: { span: Span }) {
  const tokens = extractTokens(span);
  const hasTokens = tokens && ((tokens.input ?? 0) > 0 || (tokens.output ?? 0) > 0);
  const hasAttrs = Object.keys(span.attributes ?? {}).length > 0;
  const inputMessages = extractMessages(span, "input");
  const outputMessages = extractMessages(span, "output");
  const hasIO = inputMessages.length > 0 || outputMessages.length > 0;

  // Only fire when the span is almost entirely empty AND has no children context.
  // (Children aren't visible here, but a span with rich attrs is never sparse.)
  if (hasTokens || hasAttrs || hasIO) return null;

  return (
    <div style={styles.infoBanner}>
      This span recorded no model response, tokens, or attributes. The
      instrumentation may have stopped before the LLM call.
    </div>
  );
}

/** Pretty-print JSON if parsable, otherwise return as-is. */
function prettifyMaybeJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Generic input/output panel for spans that aren't a chat (chains, parsers,
 * runnables). LangChain emits these as JSON blobs in input.value / output.value.
 */
function GenericIO({ label, value }: { label: string; value: string }) {
  const pretty = prettifyMaybeJson(value);
  return (
    <div style={styles.ioBlock}>
      <div style={styles.ioHeader}>
        <span style={styles.ioLabel}>{label}</span>
        <CopyButton value={value} title={`Copy ${label.toLowerCase()}`} />
      </div>
      <pre style={styles.code}>{pretty}</pre>
    </div>
  );
}

/**
 * Catch-all attribute table. Hides keys we already render elsewhere (messages,
 * tool calls, metadata that's already in the StatBar/MetaGrid) so this stays
 * useful for "what else is in here" inspection rather than duplicating info.
 */
const HIDDEN_KEY_PATTERNS = [
  /^gen_ai\.(input|output)\.messages$/,
  /^gen_ai\.system$/,
  /^gen_ai\.operation\.name$/,
  /^gen_ai\.request\.model$/,
  /^gen_ai\.response\.model$/,
  /^gen_ai\.response\.finish_reasons$/,
  /^gen_ai\.usage\./,
  /^llm\.(input|output)_messages\./,
  /^llm\.token_count\./,
  /^llm\.(model_name|provider|system)$/,
  /^openinference\.span\.kind$/,
  /^input\.(value|mime_type)$/,
  /^output\.(value|mime_type)$/,
  /^tool\.(name|description|call_id)$/,
  /^eval\./,
];

function AttributesTable({ span }: { span: Span }) {
  const entries = Object.entries(span.attributes ?? {}).filter(
    ([k]) => !HIDDEN_KEY_PATTERNS.some((re) => re.test(k))
  );
  if (entries.length === 0) return null;
  return (
    <details style={styles.attrDetails}>
      <summary style={styles.attrSummary}>Other attributes ({entries.length})</summary>
      <div style={styles.attrGrid}>
        {entries.map(([k, v]) => (
          <div key={k} style={styles.attrRow}>
            <span style={styles.attrKey}>{k}</span>
            <span style={styles.attrVal} title={v}>{v}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function SpanDetail({ span }: { span: Span }) {
  const toolCalls = extractToolCalls(span);
  const inputMessages = extractMessages(span, "input");
  const outputMessages = extractMessages(span, "output");
  // Suppress the generic input.value/output.value block when:
  //   - the span has structured chat messages (would duplicate content), OR
  //   - the span is a tool execution (input.value/output.value ARE the tool
  //     call args/result already rendered in the ToolCalls card above).
  const hasMessages = inputMessages.length > 0 || outputMessages.length > 0;
  const isToolSpan = toolCalls.length > 0 && classifySpan(span) === "tool";
  const genericIO = (hasMessages || isToolSpan) ? null : extractGenericIO(span);

  // If only one side of the conversation was captured, surface that in the
  // opposite slot rather than silently dropping it.
  const hasInputOnly = inputMessages.length > 0 && outputMessages.length === 0;
  const hasOutputOnly = outputMessages.length > 0 && inputMessages.length === 0;
  const showPlaceholder = isLikelyLlmSpan(span) && (hasInputOnly || hasOutputOnly);

  return (
    <div style={styles.root}>
      <StatBar span={span} />
      <StatusBanner span={span} />
      <InstrumentationGapBanner span={span} />
      <MetaGrid span={span} />

      <ToolCalls calls={toolCalls} />

      {hasMessages && (
        <div style={styles.messages}>
          {inputMessages.map((m, i) => <MessageBubble key={`in-${i}`} {...m} />)}
          {outputMessages.map((m, i) => <MessageBubble key={`out-${i}`} {...m} />)}
          {showPlaceholder && hasInputOnly && (
            <MissingMessagePlaceholder role="assistant" hint="No assistant output recorded." />
          )}
          {showPlaceholder && hasOutputOnly && (
            <MissingMessagePlaceholder role="user" hint="No user input recorded." />
          )}
        </div>
      )}

      {genericIO && (
        <div style={styles.ioWrap}>
          {genericIO.input && <GenericIO label="Input" value={genericIO.input} />}
          {genericIO.output && <GenericIO label="Output" value={genericIO.output} />}
        </div>
      )}

      <AttributesTable span={span} />
    </div>
  );
}

/**
 * The placeholder only makes sense for spans that were *supposed* to call a
 * model — chains, parsers, and retrievals legitimately have one-sided I/O.
 */
function isLikelyLlmSpan(span: Span): boolean {
  const kind = classifySpan(span);
  return kind === "llm" || kind === "agent";
}

const styles: Record<string, React.CSSProperties> = {
  root: { padding: 24 },

  // Stat bar
  statBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "10px 16px",
    minHeight: 24,           // keep the card visible even when only "0ms" is shown
    marginBottom: 20,
    flexWrap: "wrap" as const,
  },
  statItem: { display: "flex", alignItems: "center", gap: 6 },
  statIcon: { width: 14, height: 14, color: "var(--color-brand)" } as React.CSSProperties,
  statValue: { fontSize: "var(--font-size)", fontWeight: 500, color: "var(--color-text)" },
  statDivider: { width: 1, height: 16, background: "var(--color-border)", margin: "0 4px" },

  // Error banner
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    background: "var(--color-error-bg, #fdecea)",
    color: "var(--color-error-text, #b71c1c)",
    border: "1px solid var(--color-error-border, #ef9a9a)",
    borderRadius: 6,
    fontSize: "var(--font-size-sm)",
    marginBottom: 16,
  },

  // Meta grid
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    rowGap: 8,
    marginBottom: 24,
  },
  metaRow: { display: "contents" },
  metaLabel: { color: "var(--color-text-secondary)", fontSize: "var(--font-size-sm)", paddingTop: 2 },
  metaValue: { color: "var(--color-text)", fontSize: "var(--font-size)", wordBreak: "break-all" as const },

  // Messages
  messages: { display: "flex", flexDirection: "column" as const, gap: 12, marginBottom: 16 },
  bubble: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "12px 14px",
  },
  bubbleUser: {},
  bubbleAssistant: {},
  bubbleSystem: {},
  bubbleHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  bubbleRole: {
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--color-brand)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  bubbleContent: {
    fontSize: "var(--font-size)",
    color: "var(--color-text)",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  bubblePlaceholder: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    fontStyle: "italic" as const,
  },

  // Info banner — surfaces instrumentation gaps for sparse spans
  infoBanner: {
    padding: "10px 14px",
    background: "var(--color-info-bg)",
    color: "var(--color-info-text)",
    border: "1px solid var(--color-info-bg)",
    borderRadius: 6,
    fontSize: "var(--font-size-sm)",
    marginBottom: 16,
  },

  // Generic IO (for chain/parser spans)
  ioWrap: { display: "flex", flexDirection: "column" as const, gap: 12, marginBottom: 16 },
  ioBlock: {
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "12px 16px",
    background: "var(--color-surface)",
  },
  ioHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  ioLabel: {
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--color-brand)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  code: {
    background: "var(--color-code-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    padding: "10px 12px",
    margin: 0,
    fontFamily: "monospace",
    fontSize: "var(--font-size-sm)",
    color: "#3d4f61",
    overflow: "auto" as const,
    maxHeight: 320,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },

  // Attributes catch-all
  attrDetails: {
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    padding: "8px 12px",
    background: "var(--color-surface)",
  },
  attrSummary: {
    cursor: "pointer",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    fontWeight: 600,
  },
  attrGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, max-content) 1fr",
    columnGap: 12,
    rowGap: 6,
    marginTop: 10,
  },
  attrRow: { display: "contents" },
  attrKey: {
    fontFamily: "monospace",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
  },
  attrVal: {
    fontFamily: "monospace",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
