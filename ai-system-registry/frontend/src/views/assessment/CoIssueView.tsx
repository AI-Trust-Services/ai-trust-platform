import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, Save, XCircle } from "lucide-react";
import { useAssessment } from "./AssessmentApp";
import { ORDERED_QUESTION_KEYS } from "./AssessmentSidebar";
import { api } from "../../api/client";
import { cn } from "@/lib/utils";
import { SolverPanel } from "./SolverPanel";

function mapLabelToTier(labelId: string | undefined): string {
  if (labelId === "HIGH_RISK") return "high";
  if (labelId === "PROHIBITED") return "prohibited";
  if (labelId === "MINIMAL") return "minimal";
  return "";
}

// Tiers the CO may issue (the dropdown options). gpai-* are not CO-issuable.
const ISSUABLE: { value: string; label: string }[] = [
  { value: "minimal", label: "Minimal or no risk" },
  { value: "high", label: "High-risk" },
  { value: "prohibited", label: "Prohibited practice" },
];

/** #348 — Compliance Officer "Issue a Risk Classification" end view. */
export default function CoIssueView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { solverResult } = useAssessment();

  const [tier, setTier] = useState<string>("");
  const [coTouched, setCoTouched] = useState(false);
  const [transparency, setTransparency] = useState(false);

  // Prefill the dropdown from the solver once it arrives — but only if the CO
  // hasn't manually selected a tier yet. Once-Initializer can't do this because
  // solverResult is usually null at mount (async fetch hasn't landed yet).
  useEffect(() => {
    if (coTouched || !solverResult) return;
    const derived = mapLabelToTier(solverResult.risk.labelId);
    if (derived) setTier(derived);
    // Transparency is orthogonal to the risk tier — mirror the solver's
    // TRANSPARENCY label into the checkbox (null = not assessed → leave off).
    setTransparency(solverResult.transparency?.result ?? false);
  }, [solverResult, coTouched]);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastQuestionKey = ORDERED_QUESTION_KEYS[ORDERED_QUESTION_KEYS.length - 1];

  // Transparency is allowed for all tiers except prohibited.
  const transparencyAllowed = tier !== "" && tier !== "prohibited";

  const issueEnabled = !busy && !!tier && confirmed;
  const rejectEnabled = !busy && note.trim().length > 0;

  const doIssue = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.issueClassification(id, {
        tier,
        transparency: transparencyAllowed && transparency,
        note: note.trim() || undefined,
        confirmed,
      });
      navigate(`/systems/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Issue failed");
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.rejectAssessment(id, note.trim());
      navigate(`/systems/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Return failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <p className="text-sm text-muted-foreground">EU AI Act Compliance</p>
      <h1 className="mt-1 text-3xl font-bold">Issue a Risk Classification</h1>
      <p className="mt-3 text-muted-foreground">
        Once you have reviewed all questions and documentation, please issue a risk classification to the Owner and
        contributors of this AI System.
      </p>

      {/* Solver result — read-only for the CO */}
      <div className="mt-6">
        <SolverPanel solverResult={solverResult} />
      </div>

      {/* CO classification panel */}
      <div className="mt-4 rounded-xl border border-border bg-card p-6">
        <span className="rounded-full bg-[#eaecee] px-3 py-1 text-xs font-medium text-[#556b82]">
          Compliance Officer
        </span>
        <p className="mt-4 text-sm font-medium">Select a final risk classification to issue:</p>
        <select
          className="mt-2 w-full max-w-sm rounded-md border border-border p-2 text-sm"
          value={tier}
          onChange={(e) => {
            setCoTouched(true);
            setTier(e.target.value);
            if (e.target.value === "prohibited") setTransparency(false);
          }}
        >
          <option value="">No risk classification</option>
          {ISSUABLE.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* Transparency obligations (Art. 50) — allowed for all tiers except prohibited */}
        {transparencyAllowed && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={transparency}
              onChange={(e) => {
                setCoTouched(true);
                setTransparency(e.target.checked);
              }}
            />
            <span>Also issue transparency obligations (Art. 50)</span>
          </label>
        )}
      </div>

      {/* Covering note */}
      <div className="mt-4">
        <p className="text-sm font-medium">Leave a comment</p>
        <textarea
          className="mt-2 min-h-28 w-full rounded-md border border-border p-3 text-sm"
          placeholder="Enter your text here"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Optional when issuing a classification; required when returning to the owner.
        </p>
      </div>

      {/* Confirmation checkbox — gates Issue */}
      <label className="mt-4 flex items-center gap-2 rounded-md border border-border p-4 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>
          I confirm I have reviewed all assessment questions and documentation and that the issued risk classification
          accurately reflects the properties of this AI System.
        </span>
      </label>

      {error && <p className="mt-3 text-sm text-[var(--danger-fg)]">{error}</p>}

      <p className="mt-6 text-sm font-medium">Assessment finalization actions:</p>
      {/* Bottom bar */}
      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={() => navigate(`/systems/${id}/assessment/q/${lastQuestionKey}`)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Previous
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/systems/${id}`)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            <Save className="size-3.5" /> Save and close
          </button>
          <button
            onClick={doReject}
            disabled={!rejectEnabled}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <XCircle className="size-3.5" /> Reject with comments
          </button>
          <button
            onClick={doIssue}
            disabled={!issueEnabled}
            className={cn(
              "rounded-md px-5 py-2 text-sm font-semibold text-white",
              issueEnabled ? "bg-[#1147E9] hover:bg-[#0d39c4]" : "cursor-not-allowed bg-[#9db4f5]",
            )}
          >
            Issue risk classification
          </button>
        </div>
      </div>
    </div>
  );
}
