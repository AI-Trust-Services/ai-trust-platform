import React from "react";
import type { AlertRule } from "../types";
import { api } from "../api/client";
import { useToast } from "../components/Toast";

interface Props {
  rules: AlertRule[];
  onRefresh: () => void;
}

const CATEGORIES = ["risk", "compliance", "observability", "registry"] as const;

export function AlertRules({ rules, onRefresh }: Props) {
  const { showToast } = useToast();

  async function toggleRule(ruleId: string) {
    try {
      const result = await api.toggleRule(ruleId);
      showToast(result.enabled ? "Rule enabled" : "Rule disabled");
      onRefresh();
    } catch (e: any) {
      showToast(e.message, true);
    }
  }

  const grouped = CATEGORIES.reduce<Record<string, AlertRule[]>>((acc, cat) => {
    acc[cat] = rules.filter((r) => r.category === cat);
    return acc;
  }, {});

  return (
    <div className="content">
      {CATEGORIES.filter((cat) => grouped[cat].length > 0).map((cat) => (
        <div key={cat}>
          <div className="category-group-header">{cat}</div>
          <div className="rules-grid">
            {grouped[cat].map((r) => (
              <div key={r.id} className={`rule-card${r.enabled ? "" : " disabled"}`}>
                <div className="rule-card-header">
                  <span className="rule-name">{r.name}</span>
                  <span className={`sev-badge sev-${r.severity}`}>{r.severity}</span>
                  <span className={`rule-enabled-badge ${r.enabled ? "on" : "off"}`}>
                    {r.enabled ? "Active" : "Disabled"}
                  </span>
                  <button
                    className="btn-ghost btn-sm"
                    style={{ marginLeft: "auto" }}
                    onClick={() => toggleRule(r.id)}
                  >
                    {r.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
                <div className="rule-description">{r.description}</div>
                <div className="rule-meta">
                  {r.threshold !== null && `Threshold: ${r.threshold} · `}
                  Source: <strong>{r.source}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
