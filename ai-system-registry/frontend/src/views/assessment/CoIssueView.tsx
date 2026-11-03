import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, Save, XCircle } from "lucide-react";
import { useAssessment } from "./AssessmentApp";
import { ORDERED_QUESTION_KEYS } from "./AssessmentSidebar";
import { api } from "../../api/client";
import { TIER_META } from "../../utils";
import { cn } from "@/lib/utils";

// Tiers the CO may issue (the dropdown options). gpai-* are not CO-issuable.
const ISSUABLE: { value: string; label: string }[] = [
  { value: "minimal", label: "Minimal or no risk" },
  { value: "limited", label: "Transparency obligations" },
  { value: "high", label: "High-risk" },
  { value: "prohibited", label: "Prohibited practice" },
];

const PRELIM_TABS = [
  { key: "minimal", label: "Minimal or no risk" },
  { key: "limited", label: "Transparency Obligations" },
  { key: "high", label: "High-risk" },
  { key: "prohibited", label: "Prohibited practice" },
];

function activeTab(tier: string): string {
  if (tier === "prohibited") return "prohibited";
  if (tier === "high" || tier.startsWith("gpai")) return "high";
  if (tier === "limited") return "limited";
  return "minimal";
}

/** #348 — Compliance Officer "Issue a Risk Classification" end view. */
export default function CoIssueView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useAssessment();

  const [tier, setTier] = useState<string>("");
  const [transparency, setTransparency] = useState(false);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastQuestionKey = ORDERED_QUESTION_KEYS[ORDERED_QUESTION_KEYS.length - 1];
  const prelimLabel = TIER_META[state.tier]?.label ?? state.tier;
  const active = activeTab(state.tier);

  // Transparency companion is only valid alongside 'high'.
  const transparencyAllowed = tier === "high";

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

      {/* Preliminary (AI-generated) classification — display only */}
      <div className="mt-6 rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <span className="rounded-full bg-[#eaecee] px-3 py-1 text-xs font-medium text-[#556b82]">
            AI-generated · not final
          </span>
          {state.org_role && (
            <span className="text-sm text-muted-foreground">
              Role: <span className="text-foreground">{state.org_role}</span>
            </span>
          )}
        </div>
        <h2 className="mt-4 text-xl font-bold">
          Preliminary Risk Classification: <span className="text-[#8b3a00]">{prelimLabel}</span>
        </h2>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {PRELIM_TABS.map((t) => (
            <div
              key={t.key}
              className={cn(
                "rounded-md border px-3 py-2 text-center text-sm",
                t.key === active
                  ? "border-[#1147E9] font-semibold text-[#1147E9]"
                  : "border-border text-muted-foreground",
              )}
            >
              {t.label}
            </div>
          ))}
        </div>
        {state.source_documents.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Based on:{" "}
            {state.source_documents
              .map((d) => (d.page != null ? `${d.name} (p. ${d.page})` : d.name))
              .join(", ")}
          </p>
        )}
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
            setTier(e.target.value);
            if (e.target.value !== "high") setTransparency(false);
          }}
        >
          <option value="">No risk classification</option>
          {ISSUABLE.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* The only allowed combo: high + transparency */}
        {transparencyAllowed && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={transparency}
              onChange={(e) => setTransparency(e.target.checked)}
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

      {/* Bottom bar */}
      <div className="mt-6 flex items-center justify-between">
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
