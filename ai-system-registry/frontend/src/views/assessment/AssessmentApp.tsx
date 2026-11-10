import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Outlet, useNavigate, useParams, useMatch } from "react-router";
import { Loader2, Save } from "lucide-react";
import type { AssessmentState } from "../../types";
import { api } from "../../api/client";
import { usePermissions } from "../../hooks/usePermissions";
import { AssessmentSidebar, ORDERED_QUESTION_KEYS } from "./AssessmentSidebar";
import { ComplianceAdvisor } from "./ComplianceAdvisor";
import { ASSESSMENT_SECTIONS } from "./AssessmentSidebar";

interface AssessmentCtx {
  state: AssessmentState;
  reload: () => Promise<void>;
  savedAt: number | null;
  markSaved: () => void;
  // Base path for all nested links — `/systems/:id/assessment` for the live cycle,
  // or `/systems/:id/assessment/view/:assessmentId` for a read-only historical one,
  // so in-app navigation stays pinned to the cycle being viewed.
  basePath: string;
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
 * and the right advisor. */
export default function AssessmentApp() {
  const { id, assessmentId: viewAssessmentId } = useParams();
  const navigate = useNavigate();
  // "View results": the /assessment/view/:assessmentId route opens that specific
  // (historical) cycle read-only, regardless of write permission.
  const { can, loading: permsLoading } = usePermissions();
  const [state, setState] = useState<AssessmentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [advisorExpanded, setAdvisorExpanded] = useState(false);

  // A question can be active under either the editable base or the read-only
  // /view/:assessmentId base.
  const editMatch = useMatch("/systems/:id/assessment/q/:questionKey");
  const viewMatch = useMatch(
    "/systems/:id/assessment/view/:assessmentId/q/:questionKey",
  );
  const activeQuestionKey =
    editMatch?.params.questionKey ?? viewMatch?.params.questionKey;

  const load = useCallback(async () => {
    // Wait for permissions to resolve: usePermissions is fail-closed (can() is
    // false while loading), so loading first would wrongly send a writer down the
    // read path and skip prefill on a brand-new assessment.
    if (!id || permsLoading) return;
    try {
      // A specific-assessment view (View results) is always read-only via /state.
      // Approvers (the compliance officer) are reviewers → always GET /state,
      // never the write-gated POST /open prefill — even though the CO role now
      // also holds systems:write (for system registration/editing), it must not
      // trigger prefill/reclassification by opening an assessment. Writers who
      // are NOT approvers (owner / engineer) prefill via POST /open (idempotent).
      const s = viewAssessmentId
        ? await api.getAssessmentState(id, viewAssessmentId)
        : can("systems:approve")
          ? await api.getAssessmentState(id)
          : can("systems:write")
            ? await api.openAssessment(id)
            : await api.getAssessmentState(id);
      setState(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open assessment");
    }
    // Depend on permsLoading + viewAssessmentId, not can (a fresh closure each
    // render would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, permsLoading, viewAssessmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(async () => {
    if (!id) return;
    const s = await api.getAssessmentState(id, viewAssessmentId);
    setState(s);
  }, [id, viewAssessmentId]);

  const markSaved = useCallback(() => setSavedAt(Date.now()), []);

  // Base path for nested links — pins historical ("View results") navigation to
  // its cycle; the live cycle uses the plain assessment base.
  const basePath = viewAssessmentId
    ? `/systems/${id}/assessment/view/${viewAssessmentId}`
    : `/systems/${id}/assessment`;

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
    <Ctx.Provider value={{ state, reload, savedAt, markSaved, basePath }}>
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
            basePath={basePath}
          />
          {/* When the advisor is expanded it covers the whole middle region
              (everything right of the question-list sidebar), so hide main. */}
          {!advisorExpanded && (
            <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--muted)]/30">
              <Outlet />
            </main>
          )}
          <ComplianceAdvisor
            key={id}
            systemId={id}
            section={sectionForQuestion(activeQuestionKey)}
            expanded={advisorExpanded}
            onExpandedChange={setAdvisorExpanded}
          />
        </div>
      </div>
    </Ctx.Provider>
  );
}
