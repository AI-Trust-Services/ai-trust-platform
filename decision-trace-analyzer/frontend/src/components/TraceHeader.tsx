import { List, Timer, Hash, Sparkles, Server, type LucideIcon } from "lucide-react";
import { type Span } from "../api/traces";
import { CopyButton } from "./CopyButton";
import { parseBackendDate } from "../lib/dates";
import { formatDuration, totalDuration } from "../lib/duration";

interface Props {
  traceId: string;
  spans: Span[];
}

/**
 * Aggregated overview of all spans in a trace. All values derive from the spans
 * already loaded — no extra API call.
 */
export function TraceHeader({ traceId, spans }: Props) {
  const totalInput = spans.reduce((s, sp) => s + (sp.input_tokens || 0), 0);
  const totalOutput = spans.reduce((s, sp) => s + (sp.output_tokens || 0), 0);
  const totalDurationMs = totalDuration(spans);
  const services = unique(spans.map((s) => s.service_name).filter(Boolean));
  const models = unique(
    spans.flatMap((s) => [s.request_model, s.response_model].filter((m): m is string => !!m))
  );
  const systems = unique(spans.map((s) => s.gen_ai_system).filter(Boolean));
  const startedAt = spans.length ? parseBackendDate(spans[0].started_at).toLocaleString() : "—";

  return (
    <div style={styles.root}>
      <div style={styles.idRow}>
        <span style={styles.idLabel}>Trace ID</span>
        <span style={styles.idValue}>{traceId}</span>
        <CopyButton value={traceId} title="Copy trace ID" />
        <span style={styles.startedAt}>· {startedAt}</span>
      </div>

      <div style={styles.statBar}>
        <Stat icon={List} label="Spans" value={String(spans.length)} />
        <Divider />
        <Stat icon={Timer} label="Duration" value={formatDuration(totalDurationMs)} />
        <Divider />
        <Stat icon={Hash} label="Tokens" value={`${(totalInput + totalOutput).toLocaleString()} (${totalInput} in / ${totalOutput} out)`} />
        <Divider />
        <Stat icon={Sparkles} label={models.length > 1 ? "Models" : "Model"} value={models.join(", ") || "—"} />
        <Divider />
        <Stat icon={Server} label={services.length > 1 ? "Services" : "Service"} value={services.join(", ") || "—"} />
        {systems.length > 0 && (
          <>
            <Divider />
            <Stat icon={Server} label="System" value={systems.join(", ")} />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statHeader}>
        <Icon style={styles.statIcon} />
        <span style={styles.statLabel}>{label}</span>
      </div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

function Divider() {
  return <div style={styles.divider} />;
}

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    padding: "16px 24px",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  },
  idRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  idLabel: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    fontWeight: 600,
  },
  idValue: {
    fontFamily: "monospace",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text)",
  },
  startedAt: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    marginLeft: 4,
  },
  statBar: {
    display: "flex",
    alignItems: "stretch",
    gap: 12,
    flexWrap: "wrap" as const,
  },
  stat: { display: "flex", flexDirection: "column" as const, gap: 4, minWidth: 0 },
  statHeader: { display: "flex", alignItems: "center", gap: 6 },
  statIcon: { width: 12, height: 12, color: "var(--color-text-secondary)" } as React.CSSProperties,
  statLabel: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  statValue: {
    fontSize: "var(--font-size)",
    fontWeight: 500,
    color: "var(--color-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  divider: { width: 1, alignSelf: "stretch", background: "var(--color-border)" },
};
