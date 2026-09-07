import { FileText } from "lucide-react";

interface Props {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/** Lightweight empty/zero-state. */
export function EmptyState({ title, description, action }: Props) {
  return (
    <div style={styles.root}>
      <FileText style={styles.icon} />
      <div style={styles.title}>{title}</div>
      {description && <div style={styles.description}>{description}</div>}
      {action && (
        <button type="button" onClick={action.onClick} style={styles.button}>
          {action.label}
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 24px",
    color: "var(--color-text-secondary)",
    textAlign: "center" as const,
  },
  icon: { width: 48, height: 48, color: "var(--color-text-secondary)", marginBottom: 16 } as React.CSSProperties,
  title: { fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--color-text)", marginBottom: 6 },
  description: { fontSize: "var(--font-size)", maxWidth: 360 },
  button: {
    marginTop: 16,
    background: "var(--color-brand)",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "8px 16px",
    fontSize: "var(--font-size)",
    fontFamily: "var(--font-family)",
    cursor: "pointer",
  },
};
