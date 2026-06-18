import React, { useState } from "react";
import type { AlertEvent } from "../types";
import { fmtDateTime, fmtValue } from "../utils";

interface Props {
  alerts: AlertEvent[];
}

export function AlertHistory({ alerts }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!alerts.length) {
    return (
      <div className="content">
        <div className="empty-state">
          <h3>No alert history</h3>
          <p>Resolved and handled alerts will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      {alerts.map((a) => {
        const isExpanded = expanded.has(a.id);
        const valueText = fmtValue(a.rule_name, a.value_at_trigger);
        return (
          <div key={a.id} className={`alert-card ${a.severity}${isExpanded ? " expanded" : ""}`}>
            <div className="alert-card-header" onClick={() => toggleExpand(a.id)}>
              <span className="alert-severity-dot" />
              <span className={`alert-category-badge cat-${a.category}`}>{a.category}</span>
              <span className="alert-title">{a.rule_name}</span>
              <span className={`sev-badge sev-${a.severity}`}>{a.severity}</span>
              <span className="alert-time">{fmtDateTime(a.triggered_at)}</span>
              <span className="alert-chevron">▶</span>
            </div>
            <div className="alert-card-body">
              <div className="alert-description">{a.description}</div>
              <div className="alert-meta">Triggered: {fmtDateTime(a.triggered_at)}</div>
              {a.resolved_at && <div className="alert-meta">Auto-resolved: {fmtDateTime(a.resolved_at)}</div>}
              {a.handled_at  && <div className="alert-meta">Marked as handled: {fmtDateTime(a.handled_at)}</div>}
              {valueText && <div className="alert-meta">{valueText}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
