import "@ui5/webcomponents-icons/dist/tree.js";
import "@ui5/webcomponents-icons/dist/timesheet.js";
import "@ui5/webcomponents-icons/dist/org-chart.js";
import "@ui5/webcomponents-icons/dist/discussion.js";

export type TraceView = "tree" | "timeline" | "graph" | "conversation";

interface Props {
  active: TraceView;
  onChange: (view: TraceView) => void;
}

const TABS: { id: TraceView; label: string; icon: string }[] = [
  { id: "conversation", label: "Conversation", icon: "discussion" },
  { id: "tree",         label: "Tree",         icon: "tree"      },
  { id: "timeline",     label: "Timeline",     icon: "timesheet" },
  { id: "graph",        label: "Graph",        icon: "org-chart" },
];

/**
 * Four-way tab bar: Tree | Timeline | Graph | Conversation.
 *
 * Graph = generic span DAG (every span, parent_span_id topology).
 * Conversation = simplified agent-loop view (LLM/Tool only, plumbing filtered).
 */
export function ViewTabs({ active, onChange }: Props) {
  return (
    <div style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              ...styles.tab,
              ...(isActive ? styles.tabActive : {}),
            }}
            type="button"
          >
            {/* @ts-ignore */}
            <ui5-icon name={tab.icon} style={{ width: 14, height: 14 } as React.CSSProperties} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "8px 12px",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-sm)",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  tabActive: {
    background: "var(--color-brand, #ff6a00)",
    color: "white",
    // Use the full `border` shorthand here too — `styles.tab` sets `border`,
    // so toggling between the two states must not mix shorthand (border) and
    // longhand (borderColor) for the same property, or React warns.
    border: "1px solid var(--color-brand, #ff6a00)",
  },
};
