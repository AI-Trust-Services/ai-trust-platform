import { useState } from "react";
import type { DashboardCard, OverviewStats, RecommendedChart } from "../types";
import DashCard from "./DashCard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AddGraphModalProps {
  activeIds: Set<string>;
  stats: OverviewStats | null;
  onAdd: (card: DashboardCard) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

// KPI cards are excluded — the 6-tile KPI row already shows these permanently.
const REGISTRY_CHARTS: RecommendedChart[] = [
  { id: "chart_by_tier",           title: "Systems by Risk Tier",    desc: "EU AI Act tier distribution",    type: "bar",   dataKey: "by_tier",             badge: "Bar"   },
  { id: "chart_by_lifecycle",      title: "Systems by Lifecycle",    desc: "Count per lifecycle state",      type: "bar",   dataKey: "by_lifecycle",        badge: "Bar"   },
  { id: "chart_compliance_tier",   title: "Compliance by Tier",      desc: "Avg compliance per tier",        type: "bar",   dataKey: "compliance_by_tier",  badge: "Bar"   },
  { id: "chart_compliance_hist",   title: "Compliance Distribution", desc: "Systems spread across 0–100%",  type: "bar",   dataKey: "compliance_histogram", badge: "Bar"   },
  { id: "chart_by_type",           title: "Systems by Type",         desc: "Application, model, service…",  type: "pie",   dataKey: "by_type",             badge: "Pie"   },
  { id: "chart_by_model_type",     title: "Models by Type",          desc: "LLM, embedding, multimodal…",   type: "pie",   dataKey: "by_model_type",       badge: "Pie"   },
  { id: "chart_by_model_provider", title: "Models by Provider",      desc: "Top model providers",            type: "bar",   dataKey: "by_model_provider",   badge: "Bar"   },
  { id: "table_recent",            title: "Recent Registrations",    desc: "Last 5 registered systems",     type: "table", badge: "Table" },
];

export default function AddGraphModal({ activeIds, stats, onAdd, onRemove, onClose }: AddGraphModalProps) {
  const [preview, setPreview] = useState<RecommendedChart | null>(REGISTRY_CHARTS[0]);

  function handleClick(rc: RecommendedChart) {
    if (activeIds.has(rc.id)) onRemove(rc.id);
    else onAdd(rc);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Add Graph</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[280px_1fr] overflow-hidden">
          {/* Left: card list */}
          <div className="max-h-[60vh] overflow-auto border-r border-border p-3">
            <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Registry
            </div>
            {REGISTRY_CHARTS.map((rc) => {
              const added = activeIds.has(rc.id);
              const focused = preview?.id === rc.id;
              return (
                <div
                  key={rc.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 transition-colors",
                    focused ? "bg-accent" : "hover:bg-accent/60",
                  )}
                  onMouseEnter={() => setPreview(rc)}
                  onClick={() => handleClick(rc)}
                >
                  <div className="flex-1">
                    <div className="text-[13px] font-medium">{rc.title}</div>
                    <div className="text-[11px] text-muted-foreground">{rc.desc}</div>
                  </div>
                  <Badge
                    variant={added ? "default" : "secondary"}
                    className={cn("shrink-0", added && "bg-[#1a7a3c]")}
                  >
                    {added ? "✓" : rc.badge}
                  </Badge>
                </div>
              );
            })}
          </div>

          {/* Right: preview pane */}
          <div className="max-h-[60vh] overflow-auto bg-background p-4">
            {preview && stats ? (
              <>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Preview
                </div>
                <DashCard card={preview} stats={stats} onRemove={() => {}} />
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
                Hover a card to preview
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
