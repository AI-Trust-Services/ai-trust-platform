interface Props {
  rows?: number;
  columns?: number;
}

/**
 * Pure-CSS shimmer skeleton rows shown while the trace list is loading for the
 * first time. Uses a global keyframes animation injected once at module load.
 */
export function TableSkeleton({ rows = 8, columns = 7 }: Props) {
  return (
    <div style={styles.root}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={styles.row}>
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} style={{ ...styles.cell, width: cellWidth(c, columns) }}>
              <div style={styles.bar} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function cellWidth(col: number, total: number): string {
  // First column wider (mimics Trace ID), last column narrower.
  if (col === 0) return "20%";
  if (col === total - 1) return "8%";
  return `${Math.floor(72 / (total - 2))}%`;
}

// Inject shimmer keyframes once — cheaper than including a CSS file just for this.
if (typeof document !== "undefined" && !document.getElementById("dta-skeleton-kf")) {
  const style = document.createElement("style");
  style.id = "dta-skeleton-kf";
  style.textContent = `
    @keyframes dta-shimmer {
      0%   { background-position: -400px 0; }
      100% { background-position: 400px 0; }
    }
  `;
  document.head.appendChild(style);
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    overflow: "hidden",
  },
  row: {
    display: "flex",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid var(--color-border)",
    gap: 16,
  },
  cell: { display: "flex", alignItems: "center" },
  bar: {
    height: 12,
    width: "100%",
    borderRadius: 4,
    background:
      "linear-gradient(90deg, var(--color-code-bg) 0%, var(--color-border) 50%, var(--color-code-bg) 100%)",
    backgroundSize: "800px 100%",
    animation: "dta-shimmer 1.4s infinite linear",
  },
};
