import { COMPLIANCE_URL } from "../api/client";
import { navigateTo } from "../hooks/useLuigi";
import type { Deadline } from "../types";

interface Props {
  deadlines: Deadline[];
  windowDays: number;
}

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function pillStyle(days: number): { color: string; background: string } {
  if (days < 7)  return { color: "#bb0000", background: "#fff5f5" };
  if (days < 14) return { color: "#e05c00", background: "#fff8f0" };
  return { color: "#e9a922", background: "#fffbf0" };
}

export default function UpcomingDeadlines({ deadlines, windowDays }: Props): JSX.Element {
  return (
    <div className="chart-card deadlines-card">
      <div className="chart-title">Upcoming Deadlines <span style={{ fontWeight: 400, color: "var(--text-secondary)", fontSize: 12 }}>— next {windowDays} days</span></div>
      {deadlines.length === 0 ? (
        <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
          No deadlines in the next {windowDays} days
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {deadlines.map((d) => {
            const days = daysUntil(d.due_date);
            const path = d.type === "obligation" ? "/home/obligations" : "/home/evidence";
            return (
              <div
                key={d.id}
                className="deadline-row"
                onClick={() => navigateTo(path, COMPLIANCE_URL)}
                style={{ cursor: "pointer" }}
              >
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                  background: d.type === "obligation" ? "#e8f0fb" : "#f0e8fb",
                  color:      d.type === "obligation" ? "#0a6ed1" : "#5a0080",
                  flexShrink: 0,
                }}>
                  {d.type === "obligation" ? "OBL" : "EVD"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {d.title}
                  </div>
                  {d.ai_system_name && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{d.ai_system_name}</div>
                  )}
                </div>
                <span className="days-pill" style={pillStyle(days)}>
                  {days === 0 ? "today" : `${days}d`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}