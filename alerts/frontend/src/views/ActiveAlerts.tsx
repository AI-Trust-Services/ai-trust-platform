import React, { useState } from "react";
import type { AlertEvent } from "../types";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { fmtDateTime, fmtAge, fmtValue } from "../utils";

interface Props {
  alerts: AlertEvent[];
  onRefresh: () => void;
}

export function ActiveAlerts({ alerts, onRefresh }: Props) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleAlert(eventId: string) {
    try {
      await api.handleEvent(eventId);
      showToast("Alert marked as handled");
      onRefresh();
    } catch (e: any) {
      showToast(e.message, true);
    }
  }

  if (!alerts.length) {
    return (
      <div className="content">
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          <h3>No active alerts</h3>
          <p>All systems are operating within normal parameters.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      {alerts.map((a) => {
        const isExpanded = expanded.has(a.id);
        const canHandle = a.alert_type === "event" && !a.handled_at;
        const valueText = fmtValue(a.rule_name, a.value_at_trigger);
        return (
          <div key={a.id} className={`alert-card ${a.severity}${isExpanded ? " expanded" : ""}`}>
            <div className="alert-card-header" onClick={() => toggleExpand(a.id)}>
              <span className="alert-severity-dot" />
              <span className={`alert-category-badge cat-${a.category}`}>{a.category}</span>
              <span className="alert-title">{a.rule_name}</span>
              <span className={`sev-badge sev-${a.severity}`}>{a.severity}</span>
              <span className="alert-time">{fmtAge(a.triggered_at)}</span>
              <span className="alert-chevron">▶</span>
            </div>
            <div className="alert-card-body">
              <div className="alert-description">{a.description}</div>
              <div className="alert-meta">Triggered: {fmtDateTime(a.triggered_at)}</div>
              {valueText && <div className="alert-meta">{valueText}</div>}
              {canHandle && (
                <div className="alert-actions">
                  <button className="btn-danger btn-sm" onClick={() => handleAlert(a.id)}>
                    Mark as handled
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
