import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  PanelRightClose,
  PanelRightOpen,
  Send,
  FileText,
  BookOpen,
  Loader2,
  Trash2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { ChatMessage, AdvisorSource } from "../../types";
import { api } from "../../api/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Static per-section EU AI Act framing shown before the first question.
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

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: AdvisorSource[];
  degraded?: boolean;
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
    try {
      const { url } = await api.getDocumentDownloadUrlIndexed(
        source.document_id,
        source.version_id ?? undefined,
      );
      const isPdf = source.ref.toLowerCase().endsWith(".pdf");
      const target = isPdf && source.page != null ? `${url}#page=${source.page}` : url;
      window.open(target, "_blank", "noopener,noreferrer");
    } catch {
      /* best-effort: a failed presign just does nothing */
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

/** Collapsible, resizable right-hand advisor: a grounded EU AI Act chat backed
 * by POST /systems/{id}/advisor/ask. Answers cite system documents (clickable,
 * deep-linked to the page) and EU AI Act references (hover for the snippet). */
export function ComplianceAdvisor({
  systemId,
  section,
  expanded,
  onExpandedChange,
}: {
  systemId?: string;
  section?: string;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const guidance = section ? SECTION_GUIDANCE[section] : undefined;

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
    setError(null);
    setInput("");
    const scoped = guidance ? `[Section: ${guidance.title}]\n${text}` : text;
    const prior = turns;
    setTurns((t) => [...t, { role: "user", content: text }]);
    setLoading(true);
    try {
      const transcript: ChatMessage[] = prior.map((t) => ({ role: t.role, content: t.content }));
      const res = await api.advisorAsk(systemId, scoped, transcript);
      setTurns((t) => [
        ...t,
        { role: "assistant", content: res.answer, sources: res.sources, degraded: res.degraded },
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
          title="Expand advisor"
        >
          <PanelRightOpen className="size-4 text-muted-foreground" />
        </button>
        <span className="[writing-mode:vertical-rl] text-xs text-muted-foreground">
          Compliance Advisor
        </span>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-l border-border bg-card",
        // Expanded: fill the whole middle region (main is unmounted by the
        // parent), i.e. everything up to the question-list sidebar. Normal: a
        // fixed side panel beside main.
        expanded ? "min-w-0 flex-1" : "w-[340px] shrink-0 transition-[width] duration-200",
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold">Compliance Advisor</span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <button
            onClick={() => setTurns([])}
            title="Clear conversation"
            disabled={turns.length === 0 || loading}
            className="disabled:opacity-40"
          >
            <Trash2 className="size-4" />
          </button>
          <button
            onClick={() => onExpandedChange(!expanded)}
            title={expanded ? "Shrink panel" : "Expand panel"}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <button onClick={() => setCollapsed(true)} title="Collapse advisor">
            <PanelRightClose className="size-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 text-sm">
        {turns.length === 0 && guidance && (
          <div className="mb-4">
            <h3 className="mb-2 font-semibold">{guidance.title}</h3>
            <p className="text-muted-foreground">{guidance.body}</p>
          </div>
        )}
        {turns.length === 0 && !guidance && (
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
                <p className="text-xs italic text-muted-foreground">No grounding sources found.</p>
              )}
              {turn.degraded && (
                <p className="text-xs italic text-[var(--warning-fg,#b57e00)]">
                  Answer may be incomplete.
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

      <div className="border-t border-border px-4 py-3">
        {error && <p className="mb-2 text-xs text-[var(--danger-fg,#d14343)]">{error}</p>}
        <div className="flex items-end gap-2">
          <Textarea
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
            className="min-h-0 resize-none text-sm"
          />
          <Button
            size="icon"
            variant="default"
            disabled={loading || !input.trim() || !systemId}
            onClick={() => send(input)}
            title="Send"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
