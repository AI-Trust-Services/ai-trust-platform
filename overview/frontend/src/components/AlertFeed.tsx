import { ALERTS_URL } from "../api/client";
import { navigateTo } from "../hooks/useLuigi";
import { fmtDate } from "../utils";
import type { AlertEvent } from "../types";

interface Props {
  alerts: AlertEvent[];
  loading?: boolean;
}

const SEVERITY_COLOR: Record<string, string> = {
  error:   "#bb0000",
  warning: "#e05c00",
  info:    "#0a6ed1",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return fmtDate(iso);
}

export default function AlertFeed({ alerts, loading }: Props) {
  return (
    <div className="chart-card alert-feed-card">
      <div className="chart-title">Active Alerts</div>
      {loading ? (
        <div style={{ padding: "12px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 36, background: "var(--bg)", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "#1a7a3c", fontSize: 13 }}>
          ✓ No active alerts
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {alerts.map((a) => (
            <div
              key={a.id}
              className="alert-row"
              onClick={() => navigateTo("/home/alerts", ALERTS_URL)}
              style={{ cursor: "pointer" }}
            >
              <span
                className="severity-dot"
                style={{ background: SEVERITY_COLOR[a.severity] ?? "#999" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {a.rule_name}
                </div>
                {a.entity_display_name && (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{a.entity_display_name}</div>
                )}
              </div>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
                {relativeTime(a.triggered_at)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4, textAlign: "right" }}>
        <span
          style={{ fontSize: 12, color: "var(--brand)", cursor: "pointer" }}
          onClick={() => navigateTo("/home/alerts", ALERTS_URL)}
        >
          View all alerts →
        </span>
      </div>
    </div>
  );
}