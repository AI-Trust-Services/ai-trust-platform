import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  PanelRightClose,
  PanelRightOpen,
  ArrowUp,
  ArrowUpRight,
  FileText,
  BookOpen,
  Loader2,
  Trash2,
  Maximize2,
  Minimize2,
  Plus,
  AtSign,
  Lightbulb,
} from "lucide-react";
import type { ChatMessage, AdvisorSource } from "../../types";
import { api } from "../../api/client";
import { QUESTION_DEF_BY_ID } from "../../config/aiQuestionnaire";
import aiTrustLogo from "../../assets/ai-trust-logo.svg";
import { cn } from "@/lib/utils";

// Static per-section EU AI Act framing used to prefix chat turns with context.
const SECTION_GUIDANCE: Record<string, { title: string; body: string }> = {
  business: {
    title: "This section refers to the EU AI Act regarding scope and intended purpose",
    body:
      "The intended purpose of an AI system drives its classification. Describe what the system is actually used for, who operates it, and in which context it is placed on the EU market or put into service.",
  },
  technical: {
    title: "This section refers to the EU AI Act regarding risk classification",
    body:
      "The EU AI Act classifies systems by risk. Prohibited practices (Art. 5), high-risk Annex III domains, general-purpose AI models, and Art. 50 transparency obligations each carry different requirements. Answer from your system's technical documentation.",
  },
};

// Pre-filled prompts shown as clickable chips above the composer; clicking one
// sends it as a chat turn.
const SUGGESTIONS: { Icon: typeof Lightbulb; label: string }[] = [
  { Icon: Lightbulb, label: "What are the implications of this question?" },
  { Icon: ArrowUpRight, label: "What should I include in my documentation?" },
];

interface Turn {
  role: "user" | "assistant";
  content: string;
  // What is actually sent to the LLM for this turn. For a user turn this is
  // `content` prefixed with the section context (`[Section: …]`); the raw
  // `content` is shown in the chat bubble. Resending `apiContent` in the
  // transcript keeps the section context present on every later turn, not just
  // the first. Absent for assistant turns (content is sent as-is).
  apiContent?: string;
  sources?: AdvisorSource[];
}

// Human-readable "what the advisor is doing" lines, cycled while a turn is in
// flight. Indicative (timer-driven) rather than tied to the live agent steps —
// the authoritative per-step record (which tool ran, etc.) lives in Langfuse.
const PROGRESS_STEPS = [
  "Reading your question…",
  "Consulting the EU AI Act…",
  "Reviewing this system's documents…",
  "Putting together a grounded answer…",
];

/** A grounding citation. Document sources deep-link to the original (jumping to
 * the cited page for PDFs); EU AI Act sources are non-clickable (cognee provides
 * no linkable anchor) and show their supporting snippet on hover. */
function SourceChip({ source }: { source: AdvisorSource }) {
  const isDoc = source.kind === "document";
  const Icon = isDoc ? FileText : BookOpen;
  const label = isDoc
    ? `${source.ref}${source.page != null ? ` (p. ${source.page})` : ""}`
    : source.ref;
  const canLink = isDoc && !!source.document_id;

  async function open() {
    if (!canLink || !source.document_id) return;
    // Open the tab synchronously inside the click handler so the browser keeps
    // the user activation; a presign request first would lose it and the tab
    // gets blocked as a pop-up. Fill its location once the URL resolves.
    const win = window.open("", "_blank", "noopener,noreferrer");
    try {
      const { url } = await api.getDocumentDownloadUrlIndexed(
        source.document_id,
        source.version_id ?? undefined,
      );
      const isPdf = source.ref.toLowerCase().endsWith(".pdf");
      const target = isPdf && source.page != null ? `${url}#page=${source.page}` : url;
      if (win) win.location.href = target;
      else window.open(target, "_blank", "noopener,noreferrer");
    } catch {
      win?.close();
    }
  }

  const className = cn(
    "inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground",
    canLink && "cursor-pointer hover:bg-muted hover:text-foreground",
  );
  const content = (
    <>
      <Icon className="size-3 shrink-0" />
      <span className="truncate max-w-[240px]">{label}</span>
    </>
  );

  return canLink ? (
    <button type="button" onClick={open} className={className} title={source.detail ?? label}>
      {content}
    </button>
  ) : (
    <span className={className} title={source.detail ?? label}>
      {content}
    </span>
  );
}

/** Vertical tab in the companion's left rail (label rotated to read bottom-up,
 *  matching the Figma design). */
function RailTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center border-b border-border py-6 font-medium transition-colors",
        active ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="rotate-180 text-xs tracking-wide [writing-mode:vertical-rl]">
        {children}
      </span>
      {active && <span className="absolute inset-y-0 right-0 w-0.5 bg-[var(--brand)]" />}
    </button>
  );
}

// Some source cells carry stray zero-width / soft-hyphen characters; strip them
// so the rendered context reads cleanly.
function cleanContext(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
}

// An ALL-CAPS line (no lowercase letters) in the owner context is a section
// heading \u2014 e.g. "RULE", "WHEN THE EXCLUSION DOES NOT APPLY", "REFERENCES".
function isHeadingLine(t: string): boolean {
  return t.length >= 2 && t.length <= 70 && /[A-Z]/.test(t) && !/[a-z]/.test(t);
}

/** Render a block's body lines: consecutive "-"/"\u2022" lines become a bullet list,
 *  everything else a paragraph. */
function renderBodyLines(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (!bullets.length) return;
    out.push(
      <ul key={`ul-${key}`} className="ml-4 list-disc space-y-1">
        {bullets.map((b, i) => (
          <li key={i}>{b.replace(/^[-\u2022]\s*/, "")}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  lines.forEach((l, i) => {
    if (/^[-\u2022]/.test(l)) {
      bullets.push(l);
    } else {
      flush(String(i));
      out.push(<p key={`p-${i}`}>{l}</p>);
    }
  });
  flush("end");
  return out;
}

/** Owner context formatted for readability: ALL-CAPS lines become headings,
 *  "-" lines become bullet lists, the rest paragraphs. Keeps a long block of
 *  text from reading as one wall. */
function OwnerContextBody({ text }: { text: string }) {
  const lines = cleanContext(text)
    .split("\n")
    .map((l) => l.trim());
  const blocks: { heading: string | null; body: string[] }[] = [];
  let cur: { heading: string | null; body: string[] } | null = null;
  for (const t of lines) {
    if (!t) continue;
    if (isHeadingLine(t)) {
      cur = { heading: t, body: [] };
      blocks.push(cur);
    } else {
      if (!cur) {
        cur = { heading: null, body: [] };
        blocks.push(cur);
      }
      cur.body.push(t);
    }
  }
  return (
    <div className="space-y-4 text-sm leading-relaxed text-[#18181d]">
      {blocks.map((b, bi) => (
        <div key={bi} className="space-y-1.5">
          {b.heading && (
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
              {b.heading}
            </h4>
          )}
          {renderBodyLines(b.body)}
        </div>
      ))}
    </div>
  );
}

/** The right-hand **Assessment Companion** panel. A vertical tab rail switches
 * between the **AI Act Companion** (grounded EU AI Act chat backed by
 * POST /systems/{id}/advisor/ask) and the per-question **Context** tab (the
 * owner-facing EU AI Act context from the questionnaire config). */
export function ComplianceAdvisor({
  systemId,
  section,
  questionKey,
  expanded,
  onExpandedChange,
  hideOwnerContext = false,
}: {
  systemId?: string;
  section?: string;
  questionKey?: string;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  // The Context tab text is owner/engineer-facing. Set for the compliance
  // officer so their context is suppressed (CO-specific context arrives under a
  // separate ticket); the tab then shows the neutral fallback and opens on chat.
  hideOwnerContext?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const guidance = section ? SECTION_GUIDANCE[section] : undefined;

  const ownerContext =
    !hideOwnerContext && questionKey
      ? QUESTION_DEF_BY_ID[questionKey]?.ownerContext
      : undefined;

  // Context-first: entering a question surfaces its context help; a question
  // with no mapped context opens straight into the chat. Re-evaluated whenever
  // the active question (and thus its context) changes.
  const [tab, setTab] = useState<"context" | "chat">("context");
  useEffect(() => {
    setTab(ownerContext ? "context" : "chat");
  }, [questionKey, ownerContext]);

  // Cycle the human-readable progress lines while a turn is in flight. Advances
  // but holds on the last line (doesn't loop back) so it reads as forward motion.
  useEffect(() => {
    if (!loading) {
      setProgressStep(0);
      return;
    }
    const t = setInterval(
      () => setProgressStep((s) => Math.min(s + 1, PROGRESS_STEPS.length - 1)),
      2500,
    );
    return () => clearInterval(t);
  }, [loading]);

  async function send(message: string) {
    const text = message.trim();
    if (!text || !systemId || loading) return;
    setTab("chat");
    setError(null);
    setInput("");
    const scoped = guidance ? `[Section: ${guidance.title}]\n${text}` : text;
    const prior = turns;
    setTurns((t) => [...t, { role: "user", content: text, apiContent: scoped }]);
    setLoading(true);
    try {
      const transcript: ChatMessage[] = prior.map((t) => ({
        role: t.role,
        content: t.apiContent ?? t.content,
      }));
      const res = await api.advisorAsk(systemId, scoped, transcript);
      setTurns((t) => [
        ...t,
        { role: "assistant", content: res.answer, sources: res.sources },
      ]);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The assistant is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center gap-4 border-l border-border bg-card py-4">
        <button
          onClick={() => {
            setCollapsed(false);
            onExpandedChange(false);
          }}
          title="Expand companion"
        >
          <PanelRightOpen className="size-4 text-muted-foreground" />
        </button>
        <span className="[writing-mode:vertical-rl] text-xs text-muted-foreground">
          Assessment Companion
        </span>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "flex h-full flex-row border-l border-border bg-card",
        // Expanded: fill the whole middle region (main is unmounted by the
        // parent), i.e. everything up to the question-list sidebar. Normal: a
        // fixed side panel beside main.
        expanded ? "min-w-0 flex-1" : "w-[408px] shrink-0 transition-[width] duration-200",
      )}
    >
      {/* Vertical tab rail (full height). */}
      <nav className="flex w-9 shrink-0 flex-col border-r border-border bg-[#f8fafe]">
        <RailTab active={tab === "chat"} onClick={() => setTab("chat")}>
          AI Act Companion
        </RailTab>
        <RailTab active={tab === "context"} onClick={() => setTab("context")}>
          Context
        </RailTab>
      </nav>

      {/* Content column. The faint diagonal brand wash matches the Figma. */}
      <div
        className="flex min-w-0 flex-1 flex-col bg-card"
        style={{
          backgroundImage:
            "linear-gradient(36deg, color-mix(in srgb, var(--brand) 8%, transparent), transparent 45%)",
        }}
      >
        {/* Header: AI Trust logo + title + panel controls. */}
        <div className="flex items-start justify-between px-7 pb-5 pt-[34px]">
          <div className="flex items-center gap-2">
            <img src={aiTrustLogo} alt="" className="h-5 w-auto" />
            <span className="text-[18px] font-semibold leading-[26px] text-foreground">
              Assessment Companion
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            {tab === "chat" && (
              <button
                onClick={() => setTurns([])}
                title="Clear conversation"
                disabled={turns.length === 0 || loading}
                className="disabled:opacity-40"
              >
                <Trash2 className="size-4" />
              </button>
            )}
            <button
              onClick={() => onExpandedChange(!expanded)}
              title={expanded ? "Shrink panel" : "Expand panel"}
            >
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button
              onClick={() => {
                setCollapsed(true);
                onExpandedChange(false);
              }}
              title="Collapse companion"
            >
              <PanelRightClose className="size-4" />
            </button>
          </div>
        </div>

        {tab === "context" ? (
          <div className="min-w-0 flex-1 overflow-y-auto px-7 pb-6 pt-2">
            {ownerContext ? (
              <>
                <h3 className="mb-4 text-[18px] font-semibold leading-[26px] text-foreground">
                  This section refers to the EU AI Act regarding…
                </h3>
                <OwnerContextBody text={ownerContext} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No additional context is available for this question.
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 py-4 text-sm">
              {turns.length === 0 && (
                <p className="mb-4 text-muted-foreground">
                  Ask a compliance question about the EU AI Act or this system. Answers are grounded in
                  the system's documents and the Act, with sources you can open.
                </p>
              )}
              <div className="space-y-3">
                {turns.map((turn, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex flex-col gap-1",
                      turn.role === "user" ? "items-end" : "items-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[90%] rounded-lg px-3 py-2",
                        turn.role === "user"
                          ? "whitespace-pre-wrap bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {turn.role === "assistant" ? (
                        <div className="advisor-md space-y-2 leading-relaxed [&_a]:text-[var(--brand)] [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:text-xs [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc [&_strong]:font-semibold">
                          <ReactMarkdown>{turn.content}</ReactMarkdown>
                        </div>
                      ) : (
                        turn.content
                      )}
                    </div>
                    {turn.sources && turn.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {turn.sources.map((s, si) => (
                          <SourceChip key={si} source={s} />
                        ))}
                      </div>
                    )}
                    {turn.role === "assistant" && turn.sources && turn.sources.length === 0 && (
                      <p className="text-xs italic text-muted-foreground">
                        No grounding sources found.
                      </p>
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="transition-opacity">{PROGRESS_STEPS[progressStep]}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Chat composer: suggestion chips + message box + disclaimer. */}
            <div className="flex flex-col gap-1.5 p-4">
              {error && <p className="text-xs text-[var(--danger-fg,#d14343)]">{error}</p>}
              <div className="flex flex-col gap-2 py-2">
                {SUGGESTIONS.map(({ Icon, label }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => send(label)}
                    disabled={loading || !systemId}
                    className="flex h-[35px] w-full items-center gap-2 rounded-lg border border-border bg-[#f8fafe] px-3 text-left transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--brand)] bg-background px-3 py-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="Ask about this section…"
                  rows={2}
                  disabled={loading || !systemId}
                  className="w-full resize-none border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Plus className="size-4" />
                    <AtSign className="size-4" />
                  </div>
                  <button
                    type="button"
                    onClick={() => send(input)}
                    disabled={loading || !input.trim() || !systemId}
                    title="Send"
                    className="flex size-9 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                </div>
              </div>
              <p className="text-center text-[10px] leading-[14px] text-muted-foreground">
                AI can make mistakes. Please check answers.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
