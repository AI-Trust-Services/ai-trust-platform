import type { AttentionSystem } from "../types";
import { TierBadge, LifecycleBadge, ComplianceBar } from "./Badges";

interface Props {
  systems: AttentionSystem[];
}

export default function AttentionTable({ systems }: Props) {
  if (!systems.length) return null;

  return (
    <div className="attention-card">
      <div className="attention-header">
        <span className="section-title" style={{ marginBottom: 0 }}>Systems Needing Attention</span>
        <span className="attention-count">{systems.length}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>System</th>
            <th>Tier</th>
            <th>Lifecycle</th>
            <th>Compliance</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {systems.map((s) => {
            const isError = s.tier === "prohibited" || (s.tier === "high" && s.compliance < 50);
            return (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{s.id}</div>
                </td>
                <td><TierBadge tier={s.tier} /></td>
                <td><LifecycleBadge lc={s.lifecycle} /></td>
                <td><ComplianceBar pct={s.compliance} /></td>
                <td><span className={`reason-pill${isError ? " error" : ""}`}>{s.reason}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
