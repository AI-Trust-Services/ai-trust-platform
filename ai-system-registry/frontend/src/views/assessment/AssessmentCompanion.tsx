import { useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { SourceDocumentRef } from "../../types";
import { cn } from "@/lib/utils";

// Static per-section EU AI Act guidance (non-chat; the AI chat is post-MVP).
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

/** Collapsible right-hand companion: static section guidance + the system's files.
 * The AI chat field is intentionally omitted (post-MVP). */
export function AssessmentCompanion({
  section,
  sourceDocuments,
}: {
  section?: string;
  sourceDocuments: SourceDocumentRef[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<"companion" | "files">("companion");
  const guidance = section ? SECTION_GUIDANCE[section] : undefined;

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center gap-4 border-l border-border bg-card py-4">
        <button onClick={() => setCollapsed(false)} title="Expand companion">
          <PanelRightOpen className="size-4 text-muted-foreground" />
        </button>
        <span className="[writing-mode:vertical-rl] text-xs text-muted-foreground">AI Act Companion</span>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex gap-3 text-sm">
          <button
            className={cn(tab === "companion" ? "font-semibold" : "text-muted-foreground")}
            onClick={() => setTab("companion")}
          >
            Assessment Companion
          </button>
          <button
            className={cn(tab === "files" ? "font-semibold" : "text-muted-foreground")}
            onClick={() => setTab("files")}
          >
            AI System Files
          </button>
        </div>
        <button onClick={() => setCollapsed(true)} title="Collapse companion">
          <PanelRightClose className="size-4 text-muted-foreground" />
        </button>
      </div>

      <div className="px-4 py-4 text-sm">
        {tab === "companion" ? (
          guidance ? (
            <>
              <h3 className="mb-2 font-semibold">{guidance.title}</h3>
              <p className="text-muted-foreground">{guidance.body}</p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Select a question to see contextual EU AI Act guidance for its section.
            </p>
          )
        ) : sourceDocuments.length > 0 ? (
          <ul className="space-y-1">
            {sourceDocuments.map((d, i) => (
              <li key={`${d.name}-${i}`} className="text-muted-foreground">
                {d.name}
                {d.page != null ? ` (p. ${d.page})` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No documents linked to this system.</p>
        )}
      </div>
    </aside>
  );
}
