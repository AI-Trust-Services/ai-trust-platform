import type { EvidenceGap } from "../types";

interface Props {
  data: EvidenceGap;
  windowDays: number;
  onClick?: () => void;
}

const ROWS = [
  { key: "expired",      label: "Expired",                     color: "#bb0000", bg: "#fff5f5" },
  { key: "expiring_soon",label: "Expiring soon",               color: "#e05c00", bg: "#fff8f0" },
  { key: "missing",      label: "Missing approved evidence",   color: "#e9a922", bg: "#fffbf0" },
] as const;

export default function EvidenceGapCard({ data, windowDays, onClick }: Props) {
  const rows = ROWS.map((r) => ({ ...r, count: data[r.key] ?? 0 }));
  const label = (r: typeof rows[number]) =>
    r.key === "expiring_soon" ? `${r.label} (${windowDays}d)` : r.label;

  return (
    <div className="chart-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <div className="chart-title">Evidence Gap</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0" }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label(r)}</span>
            <span style={{
              minWidth: 32, textAlign: "center", fontWeight: 600, fontSize: 13,
              padding: "2px 10px", borderRadius: 10,
              color: r.count > 0 ? r.color : "#1a7a3c",
              background: r.count > 0 ? r.bg : "#f0faf4",
            }}>
              {r.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}