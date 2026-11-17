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
  ChevronDown,
} from "lucide-react";
import type { ChatMessage, AdvisorSource } from "../../types";
import { api } from "../../api/client";
import { QUESTION_DEF_BY_ID } from "../../config/aiQuestionnaire";
import aiTrustLogo from "../../assets/ai-trust-logo.svg";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

/** The per-question "Examples" list, shared verbatim by the owner and CO
 *  context views. Each bullet in the source `examples` text is one example; a
 *  leading "[Flag]" (e.g. "[Not excluded]", "[High-risk]", "[Prohibited]") is
 *  lifted out of the text and shown as a small heading above that example — 249
 *  of 265 source bullets carry one. Bullets with no flag (e.g. the definitional
 *  "is this an AI system?" examples) render as plain text with no heading. */
function ExamplesList({ text }: { text: string }) {
  const items = cleanContext(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-•]\s*/, ""));
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const m = item.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
        const flag = m ? m[1].trim() : null;
        const body = (m ? m[2] : item).trim();
        return (
          <div key={i} className="space-y-0.5">
            {flag && <h5 className="text-xs font-semibold text-foreground">{flag}</h5>}
            <p className="leading-relaxed">{linkify(body)}</p>
          </div>
        );
      })}
    </div>
  );
}

/** Owner context formatted for readability: ALL-CAPS lines become headings,
 *  "-" lines become bullet lists, the rest paragraphs. Keeps a long block of
 *  text from reading as one wall. */
function OwnerContextBody({ text, examples }: { text: string; examples?: string }) {
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
  // The owner view deliberately drops the "REFERENCES" section (legal citations
  // for the compliance officer) — owners get the plain-language context only.
  // The CO view (CoContextBody) keeps its sources.
  const ownerBlocks = blocks.filter((b) => !/^references$/i.test(b.heading?.trim() ?? ""));
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#18181d]">
      {ownerBlocks.map((b, bi) => {
        const hasBody = b.body.some(Boolean);
        // Every section with content collapses by default (same as the CO
        // view). A heading-less block (e.g. a context that is a single
        // paragraph) collapses under a generic "Context" title.
        if (!hasBody) {
          return (
            <div key={bi} className="space-y-1.5">
              {b.heading && (
                <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {b.heading}
                </h4>
              )}
              {renderBodyLines(b.body)}
            </div>
          );
        }
        return (
          <ContextCollapsible key={bi} heading={b.heading ?? "Context"}>
            {renderBodyLines(b.body)}
          </ContextCollapsible>
        );
      })}
      {examples && (
        <ContextCollapsible heading="Examples">
          <ExamplesList text={examples} />
        </ContextCollapsible>
      )}
    </div>
  );
}

// Matches an external URL embedded inline in the CO legal text (stops at
// whitespace and a closing paren, which usually wraps the link).
const CO_URL_RE = /https?:\/\/[^\s)]+/g;

// Section-label lines in the CO legal text that aren't ALL-CAPS: "Summary:",
// "AI Act provision:", "Recitals", "Guidelines", etc. A short line ending in a
// colon is treated as a heading too (e.g. "EC Guidelines on … (url):").
const CO_HEADING_WORDS = new Set([
  "summary",
  "ai act provision",
  "ai act provisions",
  "recitals",
  "recital",
  "guidelines",
  "guidance",
  "references",
]);

function isCoHeading(t: string): boolean {
  if (isHeadingLine(t)) return true;
  if (t.endsWith(":") && t.length <= 90) return true;
  return CO_HEADING_WORDS.has(t.replace(/:$/, "").trim().toLowerCase());
}

/** Turn URLs in a text run into external links; plain text otherwise. */
function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(CO_URL_RE)) {
    const offset = m.index ?? 0;
    const raw = m[0];
    const clean = raw.replace(/[.,;:]+$/, "");
    if (offset > last) out.push(text.slice(last, offset));
    out.push(
      <a
        key={key++}
        href={clean}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words text-[var(--brand)] underline"
      >
        {clean}
      </a>,
    );
    const tail = raw.slice(clean.length);
    if (tail) out.push(tail);
    last = offset + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Unique external URLs across the whole CO context, for the Sources list. */
function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(CO_URL_RE)) {
    seen.add(m[0].replace(/[.,;:]+$/, ""));
  }
  return [...seen];
}

/** Render a CO block's body: blank lines split paragraphs, "-"/"•" lines become
 *  bullet lists, URLs become external links. */
function renderCoBody(body: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let key = 0;
  const flushPara = () => {
    if (para.length) {
      out.push(<p key={`p-${key++}`}>{linkify(para.join(" "))}</p>);
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${key++}`} className="ml-4 list-disc space-y-1">
          {bullets.map((b, i) => (
            <li key={i}>{linkify(b.replace(/^[-•]\s*/, ""))}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of body) {
    if (!line) {
      flushBullets();
      flushPara();
    } else if (/^[-•]/.test(line)) {
      flushPara();
      bullets.push(line);
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushBullets();
  flushPara();
  return out;
}

// Collapsed-by-default section used by both the owner and CO context views: a
// heading row that toggles its body open. Remounts (via the key on the context
// body) reset every section back to collapsed on question navigation.
function ContextCollapsible({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Collapsible className="rounded-md border border-border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground">
        <span>{heading}</span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Compliance-officer legal context (issue #409). Longer and more structured
 *  than the owner context: the title stays open, every section with body —
 *  including the Summary — collapses by default, inline URLs are clickable, and
 *  all external links are gathered into a collapsed-by-default Sources list at
 *  the end. */
function CoContextBody({ text, examples }: { text: string; examples?: string }) {
  const cleaned = cleanContext(text);
  const blocks: { heading: string | null; body: string[] }[] = [];
  let cur: { heading: string | null; body: string[] } | null = null;
  for (const raw of cleaned.split("\n")) {
    const t = raw.trim();
    if (!t) {
      if (cur) cur.body.push("");
      continue;
    }
    if (isCoHeading(t)) {
      cur = { heading: t.replace(/:$/, ""), body: [] };
      blocks.push(cur);
    } else {
      if (!cur) {
        cur = { heading: null, body: [] };
        blocks.push(cur);
      }
      cur.body.push(t);
    }
  }
  const sources = extractUrls(cleaned);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#18181d]">
      {blocks.map((b, i) => {
        const hasBody = b.body.some(Boolean);
        // Blocks without a body (e.g. the title) render as a plain heading;
        // everything with content collapses by default — the Summary included.
        if (!hasBody) {
          return (
            <div key={i} className="space-y-1.5">
              {b.heading && (
                <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {b.heading}
                </h4>
              )}
              {renderCoBody(b.body)}
            </div>
          );
        }
        return (
          <ContextCollapsible key={i} heading={b.heading ?? "Details"}>
            {renderCoBody(b.body)}
          </ContextCollapsible>
        );
      })}
      {examples && (
        // Below the context sections, above the Sources list.
        <ContextCollapsible heading="Examples">
          <ExamplesList text={examples} />
        </ContextCollapsible>
      )}
      {sources.length > 0 && (
        <ContextCollapsible heading={`Sources (${sources.length})`}>
          <ul className="space-y-1">
            {sources.map((u, i) => (
              <li key={i}>
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-words text-[var(--brand)] underline"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </ContextCollapsible>
      )}
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
  isComplianceOfficer = false,
}: {
  systemId?: string;
  section?: string;
  questionKey?: string;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  // The Context tab is role-split: owners/engineers see the owner context,
  // the compliance officer (reviewer, systems:approve) sees the CO legal
  // context. Never show one role the other's text.
  isComplianceOfficer?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const guidance = section ? SECTION_GUIDANCE[section] : undefined;

  const def = questionKey ? QUESTION_DEF_BY_ID[questionKey] : undefined;
  // Role-split context: CO sees the legal CO context, everyone else the owner
  // context. `activeContext` drives the context-first tab defaulting below.
  const activeContext = isComplianceOfficer ? def?.coContext : def?.ownerContext;

  // Context-first only as the initial default. After that the tab is purely the
  // user's choice and persists across question navigation — we deliberately do
  // NOT auto-switch when a question has no context: the Context tab shows a
  // "no additional context" fallback instead of yanking the user back to chat.
  const [tab, setTab] = useState<"context" | "chat">("context");

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
            {activeContext ? (
              <>
                <h3 className="mb-4 text-[18px] font-semibold leading-[26px] text-foreground">
                  This section refers to the EU AI Act regarding…
                </h3>
                {isComplianceOfficer ? (
                  // Key by questionKey so navigating questions remounts the
                  // renderer and resets every collapsible (sections + Sources)
                  // back to its collapsed-by-default state.
                  <CoContextBody key={questionKey} text={activeContext} examples={def?.examples} />
                ) : (
                  <OwnerContextBody
                    key={questionKey}
                    text={activeContext}
                    examples={def?.examples}
                  />
                )}
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
