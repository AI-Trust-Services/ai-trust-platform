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
  Search,
  Upload,
  Sparkles,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import type { ChatMessage, AdvisorSource, AssessmentFile } from "../../types";
import { api } from "../../api/client";
import {
  QUESTION_DEF_BY_ID,
  isMultiselect,
  type AiQuestionDef,
} from "../../config/aiQuestionnaire";
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
  apiContent?: string;
  sources?: AdvisorSource[];
}

const PROGRESS_STEPS = [
  "Reading your question…",
  "Consulting the EU AI Act…",
  "Reviewing this system's documents…",
  "Putting together a grounded answer…",
];

/** A grounding citation. Document sources deep-link to the original; EU AI Act
 * sources are non-clickable and show their snippet on hover. */
function SourceChip({ source }: { source: AdvisorSource }) {
  const isDoc = source.kind === "document";
  const Icon = isDoc ? FileText : BookOpen;
  const label = isDoc
    ? `${source.ref}${source.page != null ? ` (p. ${source.page})` : ""}`
    : source.ref;
  const canLink = isDoc && !!source.document_id;

  async function open() {
    if (!canLink || !source.document_id) return;
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

/** Vertical tab in the companion's left rail. */
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

function cleanContext(s: string): string {
  return s.replace(/[​-‍﻿­]/g, "");
}

function isHeadingLine(t: string): boolean {
  return t.length >= 2 && t.length <= 120 && /[A-Z]/.test(t) && !/[a-z]/.test(t);
}

function renderBodyLines(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (!bullets.length) return;
    out.push(
      <ul key={`ul-${key}`} className="ml-4 list-disc space-y-1">
        {bullets.map((b, i) => (
          <li key={i}>{b.replace(/^[-•]\s*/, "")}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  lines.forEach((l, i) => {
    if (/^[-•]/.test(l)) {
      bullets.push(l);
    } else {
      flush(String(i));
      out.push(<p key={`p-${i}`}>{l}</p>);
    }
  });
  flush("end");
  return out;
}

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

function ExamplesBody({ examples, extended }: { examples: string; extended?: string }) {
  return (
    <>
      <ExamplesList text={examples} />
      {extended && (
        <>
          <h5 className="mt-4 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-foreground">
            Extended examples
          </h5>
          <ExamplesList text={extended} />
        </>
      )}
    </>
  );
}

function OwnerContextBody({
  text,
  examples,
  extendedExamples,
}: {
  text: string;
  examples?: string;
  extendedExamples?: string;
}) {
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
  const ownerBlocks = blocks.filter((b) => !/^references$/i.test(b.heading?.trim() ?? ""));
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#18181d]">
      {ownerBlocks.map((b, bi) => {
        const hasBody = b.body.some(Boolean);
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
          <ExamplesBody examples={examples} extended={extendedExamples} />
        </ContextCollapsible>
      )}
    </div>
  );
}

const CO_URL_RE = /https?:\/\/[^\s)]+/g;

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

function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(CO_URL_RE)) {
    seen.add(m[0].replace(/[.,;:]+$/, ""));
  }
  return [...seen];
}

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

function CoContextBody({
  text,
  examples,
  extendedExamples,
}: {
  text: string;
  examples?: string;
  extendedExamples?: string;
}) {
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
        <ContextCollapsible heading="Examples">
          <ExamplesBody examples={examples} extended={extendedExamples} />
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

function parseSelectedValues(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function OptionContextGroups({
  def,
  selectedValues,
  isComplianceOfficer,
}: {
  def: AiQuestionDef;
  selectedValues: string[];
  isComplianceOfficer: boolean;
}) {
  if (!isMultiselect(def)) return null;
  const selected = def.allowedAnswers.filter((o) => selectedValues.includes(o.value));
  if (selected.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Select one or more options to see the EU AI Act guidance for each.
      </p>
    );
  }
  const withContext = selected.filter((o) =>
    isComplianceOfficer ? o.coContext : o.ownerContext,
  );
  if (withContext.length === 0) return null;
  return (
    <div className="space-y-5">
      {withContext.map((o) => {
        const text = (isComplianceOfficer ? o.coContext : o.ownerContext) as string;
        return (
          <div key={o.value} className="space-y-2">
            <h4 className="text-sm font-semibold leading-snug text-foreground">{o.label}</h4>
            {isComplianceOfficer ? (
              <CoContextBody text={text} examples={o.examples} extendedExamples={o.extendedExamples} />
            ) : (
              <OwnerContextBody text={text} examples={o.examples} extendedExamples={o.extendedExamples} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Figma purple accent used in the AI System Files tab.
const FILES_PURPLE = "#7c3aed";

// Try to parse a page number from an LLM location string ("p.14", "page 3",
// "section 3" does NOT parse). Returns null when no page can be detected.
function parsePageNumber(location: string | null | undefined): number | null {
  if (!location) return null;
  const m = location.match(/(?:p\.?\s*|page\s+)(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** One file card in the AI System Files tab. Collapses/expands on click or when
 *  a search term matches. */
function FileCard({
  file,
  isThisQuestion,
  activeQuestionPos,
  forceExpand,
}: {
  file: AssessmentFile;
  isThisQuestion: boolean;
  activeQuestionPos: number | null;
  forceExpand: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || forceExpand;

  const citedCount = file.citations.length;
  const distinctQuestions = new Set(file.citations.map((c) => c.question_key)).size;

  return (
    <div
      className={cn(
        "rounded-lg border bg-background transition-colors",
        isThisQuestion ? "border-[#7c3aed]/40" : "border-border",
      )}
    >
      {/* Card header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <FileText
          className="mt-0.5 size-4 shrink-0"
          style={{ color: citedCount > 0 ? FILES_PURPLE : undefined }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{file.filename}</span>
            {isThisQuestion && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: `${FILES_PURPLE}20`, color: FILES_PURPLE }}
              >
                This question
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {file.version_label && <span>v{file.version_label}</span>}
            {file.version_label && citedCount > 0 && <span>·</span>}
            {citedCount > 0 && (
              <span>cited in {distinctQuestions} ans…</span>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Citation list + actions (expanded) */}
      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {file.citations.length > 0 ? (
            <div className="mb-2 space-y-1.5">
              {file.citations.map((c, i) => {
                const page = parsePageNumber(c.location);
                const isActive = activeQuestionPos !== null && c.question_position === activeQuestionPos;
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded px-2 py-1 text-xs",
                      isActive ? "bg-[#7c3aed]/10" : "bg-muted/50",
                    )}
                  >
                    <div className="flex items-center gap-1 font-medium text-foreground">
                      {page != null && (
                        <span
                          className="shrink-0 rounded border px-1 text-[10px] font-semibold"
                          style={{ borderColor: FILES_PURPLE, color: FILES_PURPLE }}
                        >
                          p.{page}
                        </span>
                      )}
                      <span className="truncate">
                        Q{c.question_position}
                        {QUESTION_DEF_BY_ID[c.question_key] && (
                          <span className="font-normal text-muted-foreground">
                            {" · "}
                            {QUESTION_DEF_BY_ID[c.question_key].question}
                          </span>
                        )}
                      </span>
                    </div>
                    {c.quote && (
                      <p className="mt-0.5 italic text-muted-foreground">"{c.quote}"</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mb-2 text-xs text-muted-foreground">Not cited in any AI answer.</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              title="Coming soon"
              className="flex cursor-not-allowed items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-50"
            >
              <ExternalLink className="size-3" />
              Open
            </button>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="flex cursor-not-allowed items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-50"
            >
              <MessageSquare className="size-3" />
              Ask about this file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The right-hand **Assessment Companion** panel. A vertical tab rail switches
 * between the **AI Act Companion** (EU AI Act context for the active question)
 * and the **AI System Files** (snapshot of indexed docs with per-answer citations). */
export function ComplianceAdvisor({
  systemId,
  assessmentId,
  section,
  questionKey,
  activeAnswer,
  expanded,
  onExpandedChange,
  isComplianceOfficer = false,
  prefillPending = false,
}: {
  systemId?: string;
  assessmentId?: string;
  section?: string;
  questionKey?: string;
  activeAnswer?: string | null;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  isComplianceOfficer?: boolean;
  prefillPending?: boolean;
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
  const activeContext = isComplianceOfficer ? def?.coContext : def?.ownerContext;
  const isOptionContextLead =
    !!def &&
    isMultiselect(def) &&
    def.allowedAnswers.some((o) => (isComplianceOfficer ? o.coContext : o.ownerContext));
  const selectedValues = parseSelectedValues(activeAnswer);
  const hasContext = !!activeContext || isOptionContextLead;

  // "AI Act Companion" = the EU AI Act context tab (renamed from "Context").
  // "files" = the AI System Files tab.
  const [tab, setTab] = useState<"context" | "chat" | "files">("context");

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

  // Question position (1-based) for the Files tab "This question" / header.
  // Derived from the question key's position in the questionnaire question list.
  // We import the QUESTION_DEF_BY_ID map but need the ordered list for position.
  // The position is baked into citations from the backend; here we just need
  // to match by question_key — the backend provides question_position on citations.
  // We pass the question key so FileCard can match citations by question_key.
  // The header "N files used for Q<pos>" reads from the first matching citation's
  // question_position (since all citations for the same question share the same pos).

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
        expanded ? "min-w-0 flex-1" : "w-[408px] shrink-0 transition-[width] duration-200",
      )}
    >
      {/* Vertical tab rail */}
      <nav className="flex w-9 shrink-0 flex-col border-r border-border bg-[#f8fafe]">
        <RailTab active={tab === "context"} onClick={() => setTab("context")}>
          AI Act Companion
        </RailTab>
        <RailTab active={tab === "files"} onClick={() => setTab("files")}>
          AI System Files
        </RailTab>
      </nav>

      {/* Content column */}
      <div
        className="flex min-w-0 flex-1 flex-col bg-card"
        style={{
          backgroundImage:
            "linear-gradient(36deg, color-mix(in srgb, var(--brand) 8%, transparent), transparent 45%)",
        }}
      >
        {/* Header */}
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

        {tab === "context" && (
          <div className="min-w-0 flex-1 overflow-y-auto px-7 pb-6 pt-2">
            {hasContext ? (
              <>
                <h3 className="mb-4 text-[18px] font-semibold leading-[26px] text-foreground">
                  This section refers to the EU AI Act regarding…
                </h3>
                {activeContext &&
                  (isComplianceOfficer ? (
                    <CoContextBody
                      key={questionKey}
                      text={activeContext}
                      examples={def?.examples}
                      extendedExamples={def?.extendedExamples}
                    />
                  ) : (
                    <OwnerContextBody
                      key={questionKey}
                      text={activeContext}
                      examples={def?.examples}
                      extendedExamples={def?.extendedExamples}
                    />
                  ))}
                {isOptionContextLead && def && (
                  <OptionContextGroups
                    key={`${questionKey}:${selectedValues.join(",")}`}
                    def={def}
                    selectedValues={selectedValues}
                    isComplianceOfficer={isComplianceOfficer}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No additional context is available for this question.
              </p>
            )}
          </div>
        )}

        {tab === "files" && (
          <FilesTabWrapper
            systemId={systemId}
            assessmentId={assessmentId}
            questionKey={questionKey}
            prefillPending={prefillPending}
          />
        )}

        {tab === "chat" && (
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

/** Wrapper that resolves questionPosition from the files data before rendering. */
function FilesTabWrapper({
  systemId,
  assessmentId,
  questionKey,
  prefillPending,
}: {
  systemId?: string;
  assessmentId?: string;
  questionKey?: string;
  prefillPending?: boolean;
}) {
  const [files, setFiles] = useState<AssessmentFile[] | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const prevPendingRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (!systemId || !assessmentId) {
      setFiles(null);
      return;
    }
    // Fetch on mount, and again when the pipeline transitions pending→done.
    const wasJustDone =
      prevPendingRef.current === true && prefillPending === false;
    prevPendingRef.current = prefillPending;
    if (files !== null && !wasJustDone) return; // already loaded, no pipeline transition
    setFetchLoading(true);
    api
      .getAssessmentFiles(systemId, assessmentId)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setFetchLoading(false));
  }, [systemId, assessmentId, prefillPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive question position from citations for the active question key
  let questionPosition: number | null = null;
  if (questionKey && files) {
    for (const f of files) {
      const c = f.citations.find((c) => c.question_key === questionKey);
      if (c) {
        questionPosition = c.question_position;
        break;
      }
    }
  }

  if (!assessmentId) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <p className="text-center text-sm text-muted-foreground">
          Open an assessment to see its documents.
        </p>
      </div>
    );
  }

  if (fetchLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted/60">
          <Upload className="size-7 text-muted-foreground/60" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">No documents yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload technical documentation, model cards or policies so the AI can cite a source
            for every answer.
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            disabled
            title="Coming soon"
            className="flex cursor-not-allowed items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50"
          >
            <Upload className="size-4" />
            Upload files
          </button>
          <p className="text-[11px] text-muted-foreground">PDF, DOCX or MD · up to 25 MB each</p>
        </div>
      </div>
    );
  }

  return (
    <FilesTab
      systemId={systemId}
      assessmentId={assessmentId}
      questionKey={questionKey}
      questionPosition={questionPosition}
      files={files}
    />
  );
}

/** The "AI System Files" tab content (receives already-loaded files). */
function FilesTab({
  questionKey,
  questionPosition,
  files,
}: {
  systemId?: string;
  assessmentId?: string;
  questionKey?: string;
  questionPosition: number | null;
  files: AssessmentFile[];
}) {
  const [search, setSearch] = useState("");

  // Sort: active-Q cited first → other cited (desc count) → uncited
  const activeKey = questionKey;
  const sorted = [...files].sort((a, b) => {
    const aCitedHere = activeKey
      ? a.citations.some((c) => c.question_key === activeKey)
      : false;
    const bCitedHere = activeKey
      ? b.citations.some((c) => c.question_key === activeKey)
      : false;
    if (aCitedHere !== bCitedHere) return aCitedHere ? -1 : 1;
    return b.citations.length - a.citations.length;
  });

  const q = search.toLowerCase().trim();
  const filtered = q ? sorted.filter((f) => f.filename.toLowerCase().includes(q)) : sorted;

  const citedHereCount = activeKey
    ? files.filter((f) => f.citations.some((c) => c.question_key === activeKey)).length
    : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Files header */}
      {activeKey && citedHereCount > 0 && questionPosition != null && (
        <div className="px-6 pb-2 pt-3">
          <p
            className="flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: FILES_PURPLE }}
          >
            <Sparkles className="size-3.5 shrink-0" />
            <span className="truncate">
              {citedHereCount} file{citedHereCount !== 1 ? "s" : ""} used for Q{questionPosition}
              {QUESTION_DEF_BY_ID[activeKey] && (
                <span className="font-normal">
                  {" · "}
                  {QUESTION_DEF_BY_ID[activeKey].question}
                </span>
              )}
            </span>
          </p>
        </div>
      )}

      {/* Search */}
      <div className="px-6 pb-3 pt-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* File cards */}
      <div className="flex-1 space-y-2 overflow-y-auto px-6 pb-6">
        {/* Search result count */}
        {q && filtered.length > 0 && (
          <p className="pb-1 text-xs text-muted-foreground">
            {filtered.length} file{filtered.length !== 1 ? "s" : ""} match{filtered.length === 1 ? "es" : ""} "{search}"
          </p>
        )}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <FileText className="size-8 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium text-foreground">No files match "{search}"</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try another term, or upload a document that covers this topic.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Clear search
            </button>
          </div>
        ) : (
          filtered.map((file) => {
            const isThisQuestion = activeKey
              ? file.citations.some((c) => c.question_key === activeKey)
              : false;
            const forceExpand = q.length > 0 && file.filename.toLowerCase().includes(q);
            return (
              <FileCard
                key={file.version_id}
                file={file}
                isThisQuestion={isThisQuestion}
                activeQuestionPos={questionPosition}
                forceExpand={forceExpand}
              />
            );
          })
        )}

        {/* Footer note + upload placeholder */}
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Files are indexed automatically. Upload a new version to re-check the answers that cite it.
          </p>
          <button
            type="button"
            disabled
            title="Coming soon"
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-xs text-muted-foreground opacity-50"
          >
            <Upload className="size-3.5" />
            Upload document
          </button>
        </div>
      </div>
    </div>
  );
}
