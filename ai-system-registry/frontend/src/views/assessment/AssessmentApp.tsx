import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Outlet, useNavigate, useParams, useMatch } from "react-router";
import { Loader2, Save } from "lucide-react";
import type { AssessmentState } from "../../types";
import { api } from "../../api/client";
import { AssessmentSidebar, ORDERED_QUESTION_KEYS } from "./AssessmentSidebar";
import { AssessmentCompanion } from "./AssessmentCompanion";
import { ASSESSMENT_SECTIONS } from "./AssessmentSidebar";

interface AssessmentCtx {
  state: AssessmentState;
  reload: () => Promise<void>;
  savedAt: number | null;
  markSaved: () => void;
}

const Ctx = createContext<AssessmentCtx | null>(null);
export const useAssessment = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAssessment must be used within AssessmentApp");
  return c;
};

function sectionForQuestion(questionKey?: string): string | undefined {
  if (!questionKey) return undefined;
  return ASSESSMENT_SECTIONS.find((s) => s.questionKeys.includes(questionKey))?.key;
}

/** Full-height single-page assessment app: loads/prefills state, renders the left
 * progress sidebar, the active screen (start page or question view via Outlet),
 * and the right companion. */
export default function AssessmentApp() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<AssessmentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const questionMatch = useMatch("/systems/:id/assessment/q/:questionKey");
  const activeQuestionKey = questionMatch?.params.questionKey;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      // openAssessment is idempotent: prefills on first call, returns cached state after.
      const s = await api.openAssessment(id);
      setState(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open assessment");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(async () => {
    if (!id) return;
    const s = await api.getAssessmentState(id);
    setState(s);
  }, [id]);

  const markSaved = useCallback(() => setSavedAt(Date.now()), []);

  // The submit gate is OWNER-confirmed on every question (backend-authoritative).
  const allConfirmed =
    !!state &&
    ORDERED_QUESTION_KEYS.every(
      (k) => state.questions.find((q) => q.question_key === k)?.owner_confirmed,
    );

  const onFinalize = async () => {
    if (!id) return;
    try {
      await api.finalizeAssessment(id);
      navigate(`/systems/${id}/assessment/submit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Finalize failed");
    }
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--danger-fg)]">
        {error}
      </div>
    );
  }
  if (!state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Our AI is reviewing your documents and pre-filling the assessment…</p>
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ state, reload, savedAt, markSaved }}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center justify-end gap-3 border-b border-border bg-card px-6 text-sm">
          {savedAt && <span className="text-muted-foreground">Changes saved.</span>}
          <button
            onClick={() => navigate(`/systems/${id}`)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-accent"
          >
            <Save className="size-3.5" /> Save and close
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <AssessmentSidebar
            state={state}
            activeQuestionKey={activeQuestionKey}
            onFinalize={onFinalize}
            finalizeEnabled={allConfirmed}
            locked={!state.editable}
          />
          <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--muted)]/30">
            <Outlet />
          </main>
          <AssessmentCompanion
            section={sectionForQuestion(activeQuestionKey)}
            sourceDocuments={state.source_documents}
          />
        </div>
      </div>
    </Ctx.Provider>
  );
}
