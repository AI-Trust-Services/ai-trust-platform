import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, Assessment, Control, Obligation } from "../types";

interface Props {
  open: boolean;
  control: Control | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function LinkObligationModal({ open, control, onClose, onSuccess }: Props): JSX.Element | null {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [assessmentId, setAssessmentId] = useState("");
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const showToast = useToast();

  // On open: load the assessment list (scoped to the control's system, or all
  // assessments for an org-wide control) plus systems for labelling, and the
  // control's currently-linked obligation IDs.
  const load = useCallback(async () => {
    if (!control) return;
    try {
      const [assess, sys, detail] = await Promise.all([
        api.getAssessments(control.ai_system_id ?? undefined),
        api.getSystems(),
        api.getControl(control.id),
      ]);
      setAssessments(assess);
      setSystemsById(Object.fromEntries(sys.map((s) => [s.id, s])));
      setLinked(new Set(detail.obligation_ids));
    } catch (e) {
      showToast(`Failed to load: ${(e as Error).message}`, true);
    }
  }, [control, showToast]);

  useEffect(() => {
    if (open) {
      setAssessmentId("");
      setObligations([]);
      load();
    }
  }, [open, load]);

  // When an assessment is picked, load only that assessment's obligations.
  useEffect(() => {
    if (!assessmentId) { setObligations([]); return; }
    (async () => {
      try {
        setObligations(await api.getObligations({ assessment_id: assessmentId }));
      } catch (e) {
        showToast(`Failed to load obligations: ${(e as Error).message}`, true);
      }
    })();
  }, [assessmentId, showToast]);

  if (!open || !control) return null;

  async function toggle(obligationId: string, isLinked: boolean) {
    if (!control) return;
    setBusy(obligationId);
    try {
      if (isLinked) {
        await api.unlinkObligation(control.id, obligationId);
        setLinked((s) => { const n = new Set(s); n.delete(obligationId); return n; });
      } else {
        await api.linkObligation(control.id, obligationId);
        setLinked((s) => new Set(s).add(obligationId));
      }
      onSuccess();
    } catch (e) {
      showToast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const orgWide = !control.ai_system_id;

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>Link Obligations — {control.title}</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div className="msg-strip info" style={{ margin: "16px 20px 0" }}>
            Linking a control marks its obligations "In Progress". When the control becomes Effective (via approved evidence), they become "Fulfilled".
          </div>
          <div style={{ padding: "16px 20px 0" }}>
            <label className="form-label" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
              Assessment
            </label>
            <select className="filter-select" style={{ width: "100%" }} value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
              <option value="">Select an assessment…</option>
              {assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {orgWide ? `${systemsById[a.ai_system_id]?.name ?? a.ai_system_id} — ${a.title}` : a.title}
                </option>
              ))}
            </select>
          </div>
          {!assessmentId ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>
              Select an assessment to see its obligations.
            </div>
          ) : obligations.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>
              This assessment has no obligations.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>Obligation</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>Ref</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>Link</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((o) => {
                  const isLinked = linked.has(o.id);
                  return (
                    <tr key={o.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 16px" }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{o.title}</div>
                        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{o.id}</div>
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 12 }}>{o.article_ref || "—"}</td>
                      <td style={{ padding: "10px 16px", textAlign: "right" }}>
                        <button
                          className={isLinked ? "btn-ghost btn-sm" : "btn-primary btn-sm"}
                          disabled={busy === o.id}
                          onClick={() => toggle(o.id, isLinked)}
                        >
                          {isLinked ? "Unlink" : "Link"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
