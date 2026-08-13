import "@ui5/webcomponents-icons/dist/sys-enter-2.js";
import "@ui5/webcomponents-icons/dist/decline.js";
import "@ui5/webcomponents-icons/dist/warning.js";
import "@ui5/webcomponents-icons/dist/error.js";
import "@ui5/webcomponents-icons/dist/question-mark.js";
import "@ui5/webcomponents-icons/dist/navigation-down-arrow.js";
import "@ui5/webcomponents-icons/dist/navigation-right-arrow.js";
import "@ui5/webcomponents-icons/dist/information.js";
import "@ui5/webcomponents-icons/dist/alert.js";
import { Icon } from "@ui5/webcomponents-react";
import { useEffect, useState } from "react";
import {
  type DecisionFlag,
  type DecisionFlagId,
  type DecisionOutcome,
  type DecisionRecord,
  type DecisionStep,
  type GuardrailUsage,
  type RetrievalUsage,
  type ToolUsage,
} from "../api/traces";

// All anomalies the backend can emit (see decision-trace-analyzer/backend/app/summary.py).
// We always render the full list so a reader doesn't have to guess what an
// "anomaly" means — the absence of a flag is itself a positive signal. Order
// matches the backend's priority (most actionable first, warnings before info).
interface KnownAnomaly {
  id: DecisionFlagId;
  label: string;
  severity: "warning" | "info";
  /** What this anomaly checks for. Shown when the flag is NOT detected. */
  description: string;
}

const KNOWN_ANOMALIES: KnownAnomaly[] = [
  {
    id: "tool_failure",
    label: "Tool failure",
    severity: "warning",
    description: "No tool call errored.",
  },
  {
    id: "retry_loop",
    label: "Retry loop",
    severity: "warning",
    description: "No step fired more than 3 times.",
  },
  {
    id: "truncated_output",
    label: "Truncated output",
    severity: "warning",
    description: "The final response was not cut off by a token limit.",
  },
  {
    id: "near_context_limit",
    label: "Near context limit",
    severity: "info",
    description: "Input stayed under 80% of the declared max_tokens.",
  },
  {
    id: "instrumentation_gap",
    label: "Instrumentation gap",
    severity: "info",
    description: "Prompt/response content was captured.",
  },
];

// Key bumped to v2 when the card moved from collapse-by-pref to expand-by-default.
// Old `trace.summary.collapsed.v1` values stay around but are ignored — leaves
// no migration debt and resets users who collapsed v1 back to the new default.
const STORAGE_KEY = "trace.summary.collapsed.v2";

interface Props {
  /** The summary record. `null` while loading, `undefined` if loading failed
   *  (kept distinct so the card can render skeleton vs. error). */
  summary: DecisionRecord | null | undefined;
  /** True while the summary fetch is in flight. */
  loading: boolean;
  /** Set if the summary fetch errored. */
  error: string | null;
}

/**
 * Interpretive, audit-focused summary of a trace — separate container from
 * TraceHeader (which holds factual aggregates only). Sits above ViewTabs so
 * the Decision/Audit lens is what a Compliance Officer sees first.
 *
 * Collapse state is persisted in localStorage under `trace.summary.collapsed.v2`
 * so the user's choice carries across traces. Wrapped in try/catch (unlike
 * the sibling pattern in ResizableSidebar) because a localStorage throw here
 * would kill the whole trace detail header.
 */
export function TraceSummary({ summary, loading, error }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      /* localStorage blocked: keep collapse state in-memory only */
    }
  }, [collapsed]);

  // Header row is always rendered (even when collapsed) so the outcome badge
  // and reason remain visible — that's the bit a Compliance Officer scans for.
  const outcome = summary?.outcome ?? "unknown";
  const badge = outcomeBadge(outcome);

  return (
    <div style={styles.root}>
      <div
        style={styles.headerRow}
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        aria-expanded={!collapsed}
        title={collapsed ? "Expand decision summary" : "Collapse decision summary"}
      >
        <Icon
          name={collapsed ? "navigation-right-arrow" : "navigation-down-arrow"}
          style={styles.caret}
        />
        <span style={styles.title}>Decision Summary</span>

        {loading && <span style={styles.loadingChip}>Loading…</span>}
        {error && !loading && (
          <span style={styles.errorChip} title={error}>Summary unavailable</span>
        )}

        {summary && (
          <span style={{ ...styles.badge, background: badge.bg, color: badge.fg }}>
            <Icon name={badge.icon} style={styles.badgeIcon} />
            {badge.label}
          </span>
        )}
      </div>

      {!collapsed && summary && <Body summary={summary} />}
      {!collapsed && loading && !summary && <SkeletonBody />}
      {!collapsed && error && !summary && (
        <div style={styles.errorBody}>{error}</div>
      )}
    </div>
  );
}

function Body({ summary }: { summary: DecisionRecord }) {
  return (
    <div style={styles.body}>
      {summary.outcome_reason && (
        <span style={styles.outcomeReason}>
          {summary.outcome_reason}
          {summary.outcome_reason_heuristic && (
            <span
              style={styles.heuristic}
              title="Classification fell back to a heuristic rule (no explicit guardrail.triggered attribute on the span)"
            >
              {" "}(heuristic)
            </span>
          )}
        </span>
      )}
      {summary.decision_path.length > 0 && (
        <DecisionPath steps={summary.decision_path} />
      )}
      <AnomaliesList flags={summary.flags} />
      <div style={styles.aggregates}>
        <ToolList items={summary.tools_used} />
        <RetrievalList items={summary.retrievals} />
        <GuardrailList items={summary.guardrails} />
      </div>
    </div>
  );
}

/**
 * Show every known anomaly with a clear detected / not detected status.
 *
 * Rationale: an empty flag list ("No anomalies detected.") leaves the reader
 * guessing what was even checked. Surfacing the full catalog with explicit
 * negative results makes the audit signal self-explanatory — and unknown
 * future backend flags still render alongside the known ones.
 */
function AnomaliesList({ flags }: { flags: DecisionFlag[] }) {
  const byId = new Map(flags.map((f) => [f.id, f]));
  const knownIds = new Set(KNOWN_ANOMALIES.map((a) => a.id as string));
  // Forward-compat: any flag the backend emitted that we don't know about
  // (e.g. a newly added FLAG_*) still renders, at the bottom of the list.
  const unknownDetected = flags.filter((f) => !knownIds.has(f.id));

  return (
    <div style={styles.flagsList}>
      {KNOWN_ANOMALIES.map((a) => {
        const hit = byId.get(a.id);
        return (
          <AnomalyRow
            key={a.id}
            label={a.label}
            severity={a.severity}
            detected={!!hit}
            detail={hit ? hit.detail : a.description}
          />
        );
      })}
      {unknownDetected.map((f) => (
        <AnomalyRow
          key={f.id}
          label={f.label}
          severity={f.severity}
          detected
          detail={f.detail}
        />
      ))}
    </div>
  );
}

function AnomalyRow({
  label,
  severity,
  detected,
  detail,
}: {
  label: string;
  severity: "info" | "warning";
  detected: boolean;
  detail: string;
}) {
  const isWarn = severity === "warning";

  // Detected rows are the signal — they get the full color treatment so a
  // reader scanning the summary spots them instantly. Not-detected rows are
  // context (so the reader knows what was checked) and stay deliberately
  // quiet: muted text, no background tint, no border accent.
  if (!detected) {
    return (
      <div style={styles.flagRowQuiet}>
        <Icon name="sys-enter-2" style={styles.flagIconQuiet} />
        <span style={styles.flagLabelQuiet}>{label}</span>
        <span style={styles.flagDetailQuiet}>{detail}</span>
      </div>
    );
  }

  const accent = isWarn
    ? "var(--color-warning-text, #b45309)"
    : "var(--color-info-text, #1d4ed8)";
  const bg = isWarn
    ? "var(--color-warning-bg, #fef3c7)"
    : "var(--color-info-bg, #eff6ff)";

  return (
    <div
      style={{
        ...styles.flagRow,
        background: bg,
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <Icon
        name={isWarn ? "alert" : "information"}
        style={{ ...styles.flagIcon, color: accent }}
      />
      <span style={styles.flagLabel}>{label}</span>
      <span style={styles.flagDetail}>{detail}</span>
    </div>
  );
}

function DecisionPath({ steps }: { steps: DecisionStep[] }) {
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>Decision path</span>
      <div style={styles.pathRow}>
        {steps.map((step, i) => (
          <span key={`${step.kind}:${step.name}:${i}`} style={styles.pathItem}>
            {i > 0 && <span style={styles.pathArrow}>→</span>}
            <span style={{ ...styles.pathBadge, ...pathBadgeStyle(step.kind) }}>
              {step.kind}
            </span>
            <span style={styles.pathName}>{step.name}</span>
            {step.count > 1 && (
              <span style={styles.pathCount}>×{step.count}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// Per-kind tint for the path badge. Subtle — the path is the headline shape,
// the badge is just a kind hint.
function pathBadgeStyle(kind: string): React.CSSProperties {
  switch (kind) {
    case "llm":
      return { background: "#dbeafe", color: "#1e40af" };
    case "tool":
      return { background: "#dcfce7", color: "#166534" };
    case "retriever":
      return { background: "#fef3c7", color: "#854d0e" };
    case "reranker":
      return { background: "#fde68a", color: "#78350f" };
    case "guardrail":
      return { background: "#fee2e2", color: "#991b1b" };
    case "agent":
      return { background: "#ede9fe", color: "#5b21b6" };
    default:
      return { background: "#f1f5f9", color: "#475569" };
  }
}

function ToolList({ items }: { items: ToolUsage[] }) {
  if (items.length === 0) return null;
  return (
    <Aggregate label="Tools used">
      {items.map((t) => (
        <span key={t.name} style={styles.aggItem}>
          <span style={styles.aggName}>{t.name}</span>
          <span style={styles.aggMeta}>
            ×{t.calls}
            {t.errors > 0 && (
              <span style={styles.aggError}>, {t.errors} error{t.errors > 1 ? "s" : ""}</span>
            )}
          </span>
        </span>
      ))}
    </Aggregate>
  );
}

function RetrievalList({ items }: { items: RetrievalUsage[] }) {
  if (items.length === 0) return null;
  return (
    <Aggregate label="Retrievals">
      {items.map((r) => (
        <span key={r.name} style={styles.aggItem}>
          <span style={styles.aggName}>{r.name}</span>
          <span style={styles.aggMeta}>×{r.calls}</span>
        </span>
      ))}
    </Aggregate>
  );
}

function GuardrailList({ items }: { items: GuardrailUsage[] }) {
  if (items.length === 0) return null;
  return (
    <Aggregate label="Guardrails">
      {items.map((g) => (
        <span key={g.name} style={styles.aggItem}>
          <span style={styles.aggName}>{g.name}</span>
          <span style={g.triggered ? styles.aggError : styles.aggMeta}>
            {g.triggered ? "triggered" : "not triggered"}
          </span>
        </span>
      ))}
    </Aggregate>
  );
}

function Aggregate({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.aggGroup}>
      <span style={styles.aggLabel}>{label}</span>
      <div style={styles.aggValues}>{children}</div>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div style={styles.body}>
      <div style={{ ...styles.skeleton, width: "60%" }} />
      <div style={{ ...styles.skeleton, width: "85%" }} />
      <div style={{ ...styles.skeleton, width: "40%" }} />
    </div>
  );
}

// --- Outcome badge ---------------------------------------------------------

interface BadgeStyle {
  label: string;
  icon: string;
  bg: string;
  fg: string;
}

function outcomeBadge(outcome: DecisionOutcome): BadgeStyle {
  switch (outcome) {
    case "answered":
      return {
        label: "Answered",
        icon: "sys-enter-2",
        bg: "var(--color-success-bg, #e3f4e6)",
        fg: "var(--color-success-text, #15803d)",
      };
    case "refused":
      return {
        label: "Refused",
        icon: "decline",
        bg: "var(--color-warning-bg, #fef3c7)",
        fg: "var(--color-warning-text, #b45309)",
      };
    case "partial":
      return {
        label: "Partial",
        icon: "warning",
        bg: "var(--color-warning-bg, #fef3c7)",
        fg: "var(--color-warning-text, #b45309)",
      };
    case "errored":
      return {
        label: "Errored",
        icon: "error",
        bg: "var(--color-error-bg, #fee2e2)",
        fg: "var(--color-error-text, #b91c1c)",
      };
    case "unknown":
    default:
      return {
        label: "Unknown",
        icon: "question-mark",
        bg: "var(--color-surface-alt, #f1f5f9)",
        fg: "var(--color-text-secondary, #475569)",
      };
  }
}

// --- Styles ----------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  root: {
    padding: "12px 24px 14px",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    cursor: "pointer",
    userSelect: "none" as const,
  },
  caret: {
    width: 14,
    height: 14,
    color: "var(--color-text-secondary)",
  } as React.CSSProperties,
  title: {
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--color-text-secondary)",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 10px",
    borderRadius: 12,
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
  },
  badgeIcon: { width: 12, height: 12 } as React.CSSProperties,
  loadingChip: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    fontStyle: "italic",
  },
  errorChip: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-error-text, #b91c1c)",
  },
  outcomeReason: {
    fontSize: "var(--font-size)",
    color: "var(--color-text)",
  },
  heuristic: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    fontStyle: "italic",
  },
  body: {
    marginTop: 10,
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  },
  // Flags ---------------------------------------------------------------------
  flagsList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  flagRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 4,
    fontSize: "var(--font-size-sm)",
    lineHeight: 1.4,
  },
  // Quiet variant for not-detected anomalies. Same layout as flagRow but no
  // background, no left-border accent, muted text — meant to recede so the
  // detected flags read as the actionable signal.
  flagRowQuiet: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "2px 0",
    fontSize: "var(--font-size-sm)",
    lineHeight: 1.4,
    color: "var(--color-text-secondary)",
  },
  flagIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
    marginTop: 1,
  } as React.CSSProperties,
  flagIconQuiet: {
    width: 12,
    height: 12,
    flexShrink: 0,
    color: "var(--color-text-secondary)",
    opacity: 0.7,
  } as React.CSSProperties,
  flagLabel: {
    fontWeight: 600,
    color: "var(--color-text)",
    flexShrink: 0,
  },
  flagLabelQuiet: {
    fontWeight: 500,
    color: "var(--color-text-secondary)",
    flexShrink: 0,
  },
  flagDetail: {
    color: "var(--color-text)",
  },
  flagDetailQuiet: {
    color: "var(--color-text-secondary)",
  },
  // Field row (Decision path) -------------------------------------------------
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  fieldLabel: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    fontWeight: 600,
  },
  // Decision path -------------------------------------------------------------
  pathRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: "4px 4px",
    flex: 1,
    minWidth: 0,
  },
  pathItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: "var(--font-size-sm)",
  },
  pathArrow: {
    color: "var(--color-text-secondary)",
    marginRight: 2,
    marginLeft: 2,
  },
  pathBadge: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    padding: "1px 6px",
    borderRadius: 8,
    lineHeight: 1.4,
  },
  pathName: {
    color: "var(--color-text)",
    fontWeight: 500,
  },
  pathCount: {
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-sm)",
  },
  // Aggregates ---------------------------------------------------------------
  aggregates: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "8px 28px",
    marginTop: 2,
  },
  aggGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  aggLabel: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    fontWeight: 600,
  },
  aggValues: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "2px 14px",
  },
  aggItem: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 6,
    fontSize: "var(--font-size)",
  },
  aggName: {
    fontWeight: 500,
    color: "var(--color-text)",
  },
  aggMeta: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
  },
  aggError: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-error-text, #b91c1c)",
  },
  skeleton: {
    height: 12,
    borderRadius: 4,
    background: "var(--color-surface-alt, #f1f5f9)",
  },
  errorBody: {
    marginTop: 10,
    padding: "8px 10px",
    background: "var(--color-error-bg, #fee2e2)",
    color: "var(--color-error-text, #b91c1c)",
    border: "1px solid var(--color-error-border, #fecaca)",
    borderRadius: 4,
    fontSize: "var(--font-size-sm)",
  },
};
