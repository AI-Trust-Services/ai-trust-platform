import { TriangleAlert } from "lucide-react";
import type { AttentionSystem } from "../types";
import { TierBadge, LifecycleBadge, ComplianceBar } from "./Badges";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Props {
  systems: AttentionSystem[];
}

export default function AttentionTable({ systems }: Props) {
  if (!systems.length) return null;

  return (
    <Card className="overflow-hidden break-inside-avoid p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--danger-bg)] text-[var(--danger-fg)]">
            <TriangleAlert className="size-4" />
          </span>
          <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Systems Needing Attention
          </span>
        </div>
        <Badge variant="destructive" className="font-semibold">{systems.length}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>System</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead>Lifecycle</TableHead>
            <TableHead>Compliance</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {systems.map((s) => {
            const isError = s.tier === "prohibited" || (s.tier === "high" && s.compliance < 50);
            return (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">{s.id}</div>
                </TableCell>
                <TableCell><TierBadge tier={s.tier} /></TableCell>
                <TableCell><LifecycleBadge lc={s.lifecycle} /></TableCell>
                <TableCell><ComplianceBar pct={s.compliance} /></TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-block rounded-md px-2 py-0.5 text-[11px] font-medium",
                      isError ? "bg-[var(--danger-bg)] text-[var(--danger-fg)]" : "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
                    )}
                  >
                    {s.reason}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
