import "@ui5/webcomponents-icons/dist/wrench.js";
import { Icon } from "@ui5/webcomponents-react";
import { type ToolCall } from "../lib/spanAttributes";
import { CopyButton } from "./CopyButton";

interface Props {
  calls: ToolCall[];
}

/**
 * Pretty-print a JSON-ish string. Tool arguments arrive as raw strings
 * (sometimes JSON, sometimes Python-style {'k': 'v'}); we try to parse-and-
 * reformat for readability and fall back to the original if it isn't JSON.
 */
function prettify(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Sectioned card that displays each tool call with args/result. */
export function ToolCalls({ calls }: Props) {
  if (calls.length === 0) return null;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <Icon name="wrench" style={styles.headerIcon} />
        <span style={styles.headerLabel}>
          {calls.length === 1 ? "Tool call" : `${calls.length} tool calls`}
        </span>
      </div>

      {calls.map((call, i) => {
        const args = prettify(call.args);
        const result = prettify(call.result);
        return (
          <div key={`${call.call_id ?? call.name}-${i}`} style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.toolName}>{call.name}</span>
              {call.call_id && (
                <span style={styles.callId} title={call.call_id}>
                  {call.call_id.slice(0, 8)}…
                </span>
              )}
            </div>

            {call.description && (
              <div style={styles.description}>{call.description}</div>
            )}

            {args && (
              <ToolBlock label="Arguments" value={args} />
            )}

            {result && (
              <ToolBlock label="Result" value={result} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.block}>
      <div style={styles.blockHeader}>
        <span style={styles.blockLabel}>{label}</span>
        <CopyButton value={value} title={`Copy ${label.toLowerCase()}`} />
      </div>
      <pre style={styles.code}>{value}</pre>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { marginBottom: 24 },
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  headerIcon: { width: 14, height: 14, color: "var(--color-brand)" } as React.CSSProperties,
  headerLabel: {
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  card: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "12px 16px",
    marginBottom: 10,
  },
  cardHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 6,
  },
  toolName: {
    fontFamily: "monospace",
    fontSize: "var(--font-size)",
    fontWeight: 600,
    color: "var(--color-brand)",
  },
  callId: {
    fontFamily: "monospace",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
  },
  description: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    marginBottom: 10,
    fontStyle: "italic",
  },
  block: { marginTop: 8 },
  blockHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  blockLabel: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    fontWeight: 500,
  },
  code: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    padding: "8px 10px",
    margin: 0,
    fontFamily: "monospace",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text)",
    overflow: "auto" as const,
    maxHeight: 240,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
};
