import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AlertTriangle, ChevronLeft, Save } from "lucide-react";
import { useAssessment } from "./AssessmentApp";
import { ORDERED_QUESTION_KEYS } from "./AssessmentSidebar";
import { api } from "../../api/client";
import { cn } from "@/lib/utils";

/** Owner "Submit to compliance officer" screen (Figma 575:5832). Reached from the
 * sidebar Finalize button once every question is confirmed. */
export default function AssessmentSubmitPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useAssessment();
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stillAssigned = state.questions.filter(
    (q) => q.assignee_username && !q.confirmed,
  ).length;
  const unconfirmed = ORDERED_QUESTION_KEYS.filter(
    (k) => !state.questions.find((q) => q.question_key === k)?.confirmed,
  ).length;

  const submit = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitAssessmentToCO(id, note.trim() || undefined);
      navigate(`/systems/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <p className="text-sm text-muted-foreground">EU AI Act Compliance</p>
      <h1 className="mt-1 text-3xl font-bold">Submit to compliance officer</h1>

      {stillAssigned > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger-fg)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {stillAssigned} question{stillAssigned === 1 ? " is" : "s are"} still assigned to colleagues. Please
            confirm these questions before submitting.
          </span>
        </div>
      )}

      <p className="mt-4 text-muted-foreground">
        Once you have confirmed the assessment and submitted it to your compliance officer, the assessment will be
        locked for editing.
      </p>

      <div className="mt-6">
        <p className="text-sm font-medium">Leave a comment</p>
        <textarea
          className="mt-2 min-h-28 w-full rounded-md border border-border p-3 text-sm"
          placeholder="Enter your text here"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <label className="mt-4 flex items-center gap-2 rounded-md border border-border p-4 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>I confirm I have reviewed all assessment questions and they accurately reflect the AI System's properties</span>
      </label>

      {error && <p className="mt-3 text-sm text-[var(--danger-fg)]">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => navigate(`/systems/${id}/assessment`)}
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
            onClick={submit}
            disabled={busy || !confirmed || unconfirmed > 0}
            className={cn(
              "rounded-md px-5 py-2 text-sm font-semibold text-white",
              busy || !confirmed || unconfirmed > 0
                ? "cursor-not-allowed bg-[#9db4f5]"
                : "bg-[#1147E9] hover:bg-[#0d39c4]",
            )}
          >
            Submit to CO
          </button>
        </div>
      </div>
    </div>
  );
}
