import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  PenLine,
  Sparkles,
} from "lucide-react";
import { api } from "../../api/client";
import type { IndexedDocument } from "../../types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Method = "ai" | "manual";

/** Method selection screen — shown before opening a brand-new assessment cycle.
 *  Lets the owner choose AI-assisted (prefill from indexed docs) or Manual
 *  (blank questionnaire, no LLM prefill). */
export default function AssessmentMethodPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { from?: string; newCycle?: boolean } | null;
  // "Start new assessment" sets newCycle: archive the approved cycle (or reopen
  // the current one) via /start-new, and don't bounce off an already-opened cycle.
  const newCycle = navState?.newCycle ?? false;

  // Cancel returns to wherever the flow was launched. In-MFE launches (detail
  // page, systems list) thread an explicit `from` so we navigate there directly.
  // A cross-MFE launch (e.g. the overview landing page) carries no `from` — the
  // browser history is the only link back, so fall back to top-window back, which
  // is unreliable for in-MFE routes but correct for a shell-level node.
  function cancel() {
    if (navState?.from) navigate(navState.from);
    else (window.top ?? window).history.back();
  }
  const [selected, setSelected] = useState<Method>("ai");
  const [systemName, setSystemName] = useState("");
  const [coName, setCoName] = useState("");
  const [indexedDocs, setIndexedDocs] = useState<IndexedDocument[]>([]);
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.getAssessmentState(id),
      api.getSystem(id),
      api.listIndexedDocuments(id).catch(() => [] as IndexedDocument[]),
    ])
      .then(([state, system, docs]) => {
        // If this cycle has already been opened (question_states seeded), skip
        // method selection and go straight to the assessment. The method page is
        // only for a genuinely NEW cycle: a "start new" flow (newCycle) begins a
        // fresh cycle ONLY when the current one is approved — /start-new archives
        // an approved cycle, but merely *continues* an in-progress (non-approved)
        // one. So when an in-progress cycle exists we always skip straight to it,
        // even under newCycle, instead of re-showing the selection.
        const startsFreshCycle =
          newCycle && state.workflow_status === "approved";
        if (state.prefilled && !startsFreshCycle) {
          navigate(`/systems/${id}/assessment`, { replace: true });
          return;
        }
        setSystemName(system.name);
        setCoName(system.compliance_officer_username ?? "");
        setIndexedDocs(
          (docs as IndexedDocument[]).filter((d) => d.status === "indexed"),
        );
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [id, navigate, newCycle]);

  async function handleStart() {
    if (!id || starting) return;
    setStarting(true);
    setError(null);
    try {
      // Both methods currently open the same AI-prefill flow; the manual-entry
      // path is handled separately (follow-up issue). A "start new" flow archives
      // the approved cycle (or reopens the current one) via /start-new.
      await (newCycle ? api.startNewAssessment(id) : api.openAssessment(id));
      navigate(`/systems/${id}/assessment`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start assessment");
      setStarting(false);
    }
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--muted)]/30">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center pb-8 pt-10 px-6">
          <div className="w-full max-w-[912px]">

            {/* Breadcrumb */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{systemName || "AI System"}</span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">New EU AI Act assessment</span>
            </div>

            <div className="h-4" />

            {/* Title */}
            <h1 className="text-[30px] font-bold leading-[38px] text-foreground">
              How do you want to complete the assessment?
            </h1>

            <div className="h-2" />

            {/* Subtitle */}
            <p className="max-w-[640px] text-sm leading-5 text-muted-foreground">
              Let our AI model assess your documentation and fill it out for you
              to review, or take the time to manually complete our
              questionnaire. Either way, you confirm every answer before it goes
              to your compliance officer.
            </p>

            <div className="h-6" />

            {/* ── Method cards ── */}
            <div className="flex gap-4 items-start w-full">

              {/* AI-assisted card */}
              <button
                onClick={() => setSelected("ai")}
                className={cn(
                  "flex-1 flex flex-col gap-[14px] h-[452px] items-start p-6 rounded-[14px] text-left transition-all bg-card",
                  selected === "ai"
                    ? "border-[1.5px] border-[#1147e9] shadow-[0px_4px_12px_0px_rgba(16,24,40,0.08)]"
                    : "border-[1.5px] border-border shadow-[0px_1px_1px_rgba(16,24,40,0.05)]",
                )}
              >
                {/* Top row: icon + stat + radio */}
                <div className="flex gap-[23px] items-start w-full">
                  <div
                    className="flex items-center justify-center rounded-[12px] shrink-0 size-11"
                    style={{
                      backgroundImage:
                        "linear-gradient(135deg, #1147e9 0%, #6d70ff 50%)",
                    }}
                  >
                    <Sparkles className="size-[22px] text-white" />
                  </div>
                  <div className="flex flex-col items-start justify-end self-stretch shrink-0">
                    <span className="text-sm font-semibold text-foreground">~10 min</span>
                    <span className="text-xs text-muted-foreground">review time</span>
                  </div>
                  <div className="flex-1" />
                  <Radio selected={selected === "ai"} />
                </div>

                {/* Heading */}
                <div className="flex flex-col gap-1 items-start w-full">
                  <div className="flex gap-2 items-center">
                    <span className="text-lg font-semibold text-foreground">
                      AI-assisted
                    </span>
                    <span className="rounded-full bg-[#eff1ff] px-[7px] py-px text-xs font-medium text-[#3100ab]">
                      Recommended
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    The AI drafts every answer from your documentation. You review,
                    edit and confirm.
                  </p>
                </div>

                {/* Benefits */}
                <BenefitList
                  items={[
                    "Answers appear in parallel — start reviewing while the AI works",
                    "Every answer cites the source page and shows a confidence level",
                    "Low-confidence answers are flagged for your attention",
                  ]}
                />

                {/* Indexed docs info box */}
                <div className="bg-[var(--muted)]/30 border border-border rounded-[8px] px-3 py-[10px] w-full flex flex-col gap-1.5">
                  {indexedDocs.length > 0 ? (
                    <>
                      <p className="text-xs font-semibold text-foreground">
                        {indexedDocs.length} document
                        {indexedDocs.length !== 1 ? "s" : ""} indexed and ready
                      </p>
                      <div className="space-y-0 text-xs text-muted-foreground">
                        {indexedDocs.map((d) => (
                          <p key={d.id}>{d.filename}</p>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No processed documents yet. Upload documents to enable
                      AI-drafted answers.
                    </p>
                  )}
                </div>
              </button>

              {/* Manual card — disabled for now (AI-assisted only) */}
              <button
                disabled
                className={cn(
                  "flex-1 flex flex-col gap-[14px] h-[452px] items-start p-6 rounded-[14px] text-left transition-all bg-card",
                  "border-[1.5px] border-border shadow-[0px_1px_1px_rgba(16,24,40,0.05)]",
                  "cursor-not-allowed opacity-60",
                )}
              >
                {/* Top row: icon + stat + radio */}
                <div className="flex gap-[23px] items-start w-full">
                  <div className="bg-[var(--muted)] flex items-center justify-center rounded-[12px] shrink-0 size-11">
                    <PenLine className="size-[22px] text-foreground" />
                  </div>
                  <div className="flex flex-col items-start justify-end self-stretch shrink-0">
                    <span className="text-sm font-semibold text-foreground">~40 min</span>
                    <span className="text-xs text-muted-foreground">review time</span>
                  </div>
                  <div className="flex-1" />
                  <Radio selected={selected === "manual"} />
                </div>

                {/* Heading */}
                <div className="flex flex-col gap-1 items-start w-full">
                  <div className="flex gap-2 items-center">
                    <span className="text-lg font-semibold text-foreground">Manual</span>
                    <span className="rounded-full bg-[var(--muted)] px-[7px] py-px text-xs font-medium text-muted-foreground">
                      Coming soon
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Answer each question yourself, in your own order.
                  </p>
                </div>

                {/* Benefits */}
                <BenefitList
                  items={[
                    "Full control over every answer from the start",
                    "The Assessment Companion explains each question and article",
                    "Ask the AI to draft a single answer whenever you want",
                  ]}
                />

                {/* Info box */}
                <div className="bg-[var(--muted)]/30 border border-border rounded-[8px] px-3 py-[10px] w-full">
                  <p className="text-xs text-muted-foreground">
                    Best when documentation is incomplete or outdated
                  </p>
                </div>
              </button>
            </div>

            <div className="h-7" />

            {/* ── What happens next ── */}
            <div className="flex items-stretch w-full overflow-hidden rounded-[10px] border border-border bg-card">
              <FlowStep
                number="1"
                title="You complete the assessment"
                description="Contributors can answer and comment"
                active
                first
              />
              <FlowStep
                number="2"
                title="Compliance officer reviews"
                description={
                  coName
                    ? `${coName} may request changes`
                    : "Your compliance officer may request changes"
                }
                active={false}
              />
              <FlowStep
                number="3"
                title="Risk classification issued"
                description="Shown on your AI System"
                active={false}
              />
            </div>

            <div className="h-4" />

            <p className="text-xs text-[#778094]">
              Progress saves automatically. You can switch any answer between AI
              and manual later.
            </p>

            {error && (
              <p className="mt-3 text-sm text-[var(--danger-fg)]">{error}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky footer ── */}
      <div className="shrink-0 border-t border-border bg-card py-[14px]">
        <div className="mx-auto flex h-10 w-full max-w-[912px] items-center justify-between">
          <Button
            variant="outline"
            onClick={cancel}
            className="h-auto rounded-[10px] px-[10px] py-1.5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={starting}
            className="h-auto gap-1.5 rounded-[10px] border-transparent bg-[#1147e9] px-[10px] py-1.5 text-white hover:bg-[#0d39c4] hover:text-white"
          >
            {starting ? (
              <Loader2 className="animate-spin" />
            ) : selected === "ai" ? (
              <Sparkles />
            ) : null}
            {selected === "ai"
              ? "Start AI-assisted assessment"
              : "Start manual assessment"}
            {!starting && <ArrowRight />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Radio({ selected }: { selected: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-2 size-4",
        selected ? "border-[#1147e9]" : "border-border",
      )}
    >
      {selected && (
        <div className="size-2 rounded-full bg-[#1147e9]" />
      )}
    </div>
  );
}

function BenefitList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col gap-2 items-start w-full">
      {items.map((item) => (
        <div key={item} className="flex gap-2 items-start w-full">
          <Check className="mt-[3px] size-3.5 shrink-0 text-[#008844]" />
          <span className="flex-1 text-sm text-foreground">{item}</span>
        </div>
      ))}
    </div>
  );
}

function FlowStep({
  number,
  title,
  description,
  active,
  first = false,
}: {
  number: string;
  title: string;
  description: string;
  active: boolean;
  first?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 gap-[10px] min-h-[60px] items-start px-4 py-[14px]",
        !first && "border-l border-border",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[11px] size-[22px] text-xs font-bold",
          active
            ? "bg-[#1147e9] text-white"
            : "bg-[var(--muted)] text-foreground",
        )}
      >
        {number}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
    </div>
  );
}
