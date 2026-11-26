import { Loader2 } from "lucide-react";
import type { ResolveResponse } from "../../types";

const BAND_CLS: Record<string, string> = {
  High: "text-[#1a9d5c] bg-[#f0fdf4] border-[#bbf7d0]",
  Medium: "text-[#b57e00] bg-[#fffbeb] border-[#fde68a]",
  Low: "text-[#d14343] bg-[#fef2f2] border-[#fecaca]",
};

function labelDisplay(labelId: string): string {
  return labelId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface SolverPanelProps {
  solverResult: ResolveResponse | null;
}

export function SolverPanel({ solverResult }: SolverPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <span className="rounded-full bg-[#eef3ff] px-3 py-1 text-xs font-medium text-[#1147E9]">
        Rule-based · updates on each confirm
      </span>
      <h2 className="mt-4 text-xl font-bold">Solver Classification</h2>
      {!solverResult ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Computing…</span>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-lg font-semibold">{labelDisplay(solverResult.risk.labelId)}</span>
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
            <p className="mt-2 text-sm text-muted-foreground">{solverResult.risk.explanation}</p>
          )}
          {solverResult.roles.filter((r) => r.result).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {solverResult.roles.filter((r) => r.result).map((r) => (
                <span
                  key={r.labelId}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    r.source === "user"
                      ? "border-[#c4b5fd] text-[#6d28d9]"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {labelDisplay(r.labelId)}
                </span>
              ))}
            </div>
          )}
          {solverResult.transparency !== null && (
            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Transparency obligations (Art. 50):</span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  solverResult.transparency.result
                    ? "border-[#bbf7d0] bg-[#f0fdf4] text-[#1a9d5c]"
                    : "border-border text-muted-foreground"
                } ${solverResult.transparency.source === "user" ? "border-[#c4b5fd] bg-[#f5f3ff] text-[#6d28d9]" : ""}`}
              >
                {solverResult.transparency.result ? "Yes" : "No"}
                {solverResult.transparency.source === "user" && " · override"}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
