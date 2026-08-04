import React, { useState } from "react";
import type { AlertEvent, AlertRule } from "../types";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { usePermissions } from "../hooks/usePermissions";
import { fmtDateTime, fmtAge, fmtValue } from "../utils";

interface Props {
  alerts: AlertEvent[];
  rules: AlertRule[];
  onRefresh: () => void;
}

export function ActiveAlerts({ alerts, rules, onRefresh }: Props) {
  const { showToast } = useToast();
  const { can } = usePermissions();
  const mayHandle = can("alerts:handle");
  const noHandleTitle = "Erfordert Berechtigung: alerts:handle";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const ruleMap = Object.fromEntries(rules.map((r) => [r.id, r]));

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

  async function approveModel(eventId: string) {
    try {
      await api.approveModel(eventId);
      showToast("Model change approved — baseline updated");
      onRefresh();
    } catch (e: any) {
      showToast(e.message, true);
    }
  }

  async function rejectModel(eventId: string) {
    try {
      await api.rejectModel(eventId);
      showToast("Model change rejected — baseline unchanged");
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
        const rule = ruleMap[a.rule_id];
        const isModelDivergence = rule?.condition_type === "model_diverged";
        const canHandle = a.alert_type === "event" && !a.handled_at;
        const valueText = fmtValue(a.rule_name, a.value_at_trigger);
        return (
          <div key={a.id} className={`alert-card ${a.severity}${isExpanded ? " expanded" : ""}`}>
            <div className="alert-card-header" onClick={() => toggleExpand(a.id)}>
              <span className="alert-severity-dot" />
              <span className={`alert-category-badge cat-${a.category}`}>{a.category}</span>
              <span className="alert-title">{a.rule_name}</span>
              {a.entity_id && (
                <span className="alert-entity-badge" title={a.entity_id}>
                  {a.entity_display_name || a.entity_id}
                </span>
              )}
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
                  {isModelDivergence ? (
                    <>
                      <button
                        className="btn-primary btn-sm"
                        disabled={!mayHandle}
                        title={mayHandle ? undefined : noHandleTitle}
                        onClick={() => approveModel(a.id)}
                      >
                        Approve new model
                      </button>
                      <button
                        className="btn-danger btn-sm"
                        disabled={!mayHandle}
                        title={mayHandle ? undefined : noHandleTitle}
                        onClick={() => rejectModel(a.id)}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn-danger btn-sm"
                      disabled={!mayHandle}
                      title={mayHandle ? undefined : noHandleTitle}
                      onClick={() => handleAlert(a.id)}
                    >
                      Mark as handled
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
