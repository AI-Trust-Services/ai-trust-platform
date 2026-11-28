import { Loader2 } from "lucide-react";
import type { ResolveResponse } from "../../types";

const BAND_CLS: Record<string, string> = {
  High: "text-[#1a9d5c] bg-[#f0fdf4] border-[#bbf7d0]",
  Medium: "text-[#b57e00] bg-[#fffbeb] border-[#fde68a]",
  Low: "text-[#d14343] bg-[#fef2f2] border-[#fecaca]",
};

const CLASSIFICATION_TABS = [
  { key: "minimal", label: "Minimal or no risk" },
  { key: "high", label: "High-risk" },
  { key: "prohibited", label: "Prohibited practice" },
];


function labelDisplay(labelId: string): string {
  return labelId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function activeTab(labelId: string): string {
  if (labelId.includes("PROHIBITED")) return "prohibited";
  if (labelId.includes("HIGH_RISK")) return "high";
  return "minimal";
}

interface SolverPanelProps {
  solverResult: ResolveResponse | null;
  pending?: boolean;
}

export function SolverPanel({ solverResult, pending }: SolverPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#eaecee] px-3 py-1 text-xs font-medium text-[#556b82]">
          AI-generated · not final
        </span>
        <span className="rounded-full bg-[#eef3ff] px-3 py-1 text-xs font-medium text-[#1147E9]">
          Rule-based · updates on each confirm
        </span>
      </div>

      {pending || !solverResult ? (
        <div className="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Computing…</span>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {CLASSIFICATION_TABS.slice(0, 1).map((t) => (
              <div
                key={t.key}
                className={
                  "rounded-md border px-3 py-2 text-center text-sm break-words hyphens-auto " +
                  (t.key === activeTab(solverResult.risk.labelId)
                    ? "border-[#1147E9] font-semibold text-[#1147E9]"
                    : "border-border text-muted-foreground")
                }
              >
                {t.label}
              </div>
            ))}
            <div
              className={
                "rounded-md border px-3 py-2 text-center text-sm break-words hyphens-auto " +
                (solverResult.transparency?.result
                  ? "border-[#d97706] font-semibold text-[#d97706]"
                  : "border-border text-muted-foreground")
              }
            >
              Transparency obligations
            </div>
            {CLASSIFICATION_TABS.slice(1).map((t) => (
              <div
                key={t.key}
                className={
                  "rounded-md border px-3 py-2 text-center text-sm break-words hyphens-auto " +
                  (t.key === activeTab(solverResult.risk.labelId)
                    ? "border-[#1147E9] font-semibold text-[#1147E9]"
                    : "border-border text-muted-foreground")
                }
              >
                {t.label}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            {solverResult.risk.confidenceBand && (
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${BAND_CLS[solverResult.risk.confidenceBand] ?? ""}`}>
                {solverResult.risk.confidenceBand} confidence
              </span>
            )}
            {solverResult.risk.source === "user" && (
              <span className="rounded-full border border-[#c4b5fd] bg-[#f5f3ff] px-2.5 py-0.5 text-xs font-medium text-[#6d28d9]">
                override
              </span>
            )}
          </div>
          {solverResult.risk.explanation && (
            <p className="mt-3 text-sm text-muted-foreground">{solverResult.risk.explanation}</p>
          )}
          {solverResult.roles.filter((r) => r.result).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {solverResult.roles.filter((r) => r.result).map((r) => (
                <span
                  key={r.labelId}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    r.source === "user" ? "border-[#c4b5fd] text-[#6d28d9]" : "border-border text-muted-foreground"
                  }`}
                >
                  {labelDisplay(r.labelId)}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
