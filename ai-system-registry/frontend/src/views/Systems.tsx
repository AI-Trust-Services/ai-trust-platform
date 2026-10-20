import { useState, useEffect, useCallback, useMemo } from "react";
import { Eye, Trash2, RefreshCw, ClipboardList } from "lucide-react";
import LuigiClient from "@luigi-project/client";
import { TierBadge, LifecycleBadge, FormattedDate } from "../components/Badges";
import SystemDetail from "../components/SystemDetail";
import type { UserMap } from "../components/SystemDetail";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import { SELECT_CLASS } from "../utils";
import type { AISystem, ModelCard } from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const EU_AI_ACT_ID = "FRM-EU-AI-ACT";

function goToAssessments(systemId: string) {
  localStorage.setItem("compliance.pendingAssessment", JSON.stringify({ systemId, frameworkId: EU_AI_ACT_ID }));
  LuigiClient.linkManager().navigate("/home/assessments");
}

export default function Systems() {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [userMap, setUserMap] = useState<UserMap>({});
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [selectedSystem, setSelectedSystem] = useState<AISystem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [indexing, setIndexing] = useState<Record<string, { indexed: number; total: number }>>({});
  const { mayWrite, mayApprove } = useModalControls();
  const showToast = useToast();

  const loadSystems = useCallback(async () => {
    try {
      const data = await api.getSystems();
      setSystems(data);
    } catch (e) {
      showToast(`Failed to load systems: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  const loadModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      setModels(data);
    } catch (e) {
      showToast(`Failed to load model catalog: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => {
    api.getAllUsers().catch(() => []).then((allUsers) => {
      const map: UserMap = {};
      for (const u of allUsers) map[u.username] = { firstName: u.firstName, lastName: u.lastName };
      setUserMap(map);
    });
  }, []);

  useEffect(() => { loadSystems(); loadModels(); }, [loadSystems, loadModels]);

  // Per-system indexing progress (indexed documents / total), read directly from the
  // document-indexing service. Polls every 3s while any system still has documents
  // being indexed. ponytail: one status call per listed system; a batch status
  // endpoint is the upgrade path if the list grows large.
  const loadIndexing = useCallback(async (sys: AISystem[]) => {
    const entries = await Promise.all(
      sys.map(async (s) => {
        try {
          const docs = await api.listIndexedDocuments(s.id);
          return [s.id, { indexed: docs.filter((d) => d.status === "indexed").length, total: docs.length }] as const;
        } catch {
          return [s.id, { indexed: 0, total: 0 }] as const;
        }
      }),
    );
    setIndexing(Object.fromEntries(entries));
  }, []);

  useEffect(() => { if (systems.length) loadIndexing(systems); }, [systems, loadIndexing]);

  useEffect(() => {
    const active = Object.values(indexing).some((v) => v.total > 0 && v.indexed < v.total);
    if (!active) return;
    const t = setInterval(() => loadIndexing(systems), 3000);
    return () => clearInterval(t);
  }, [indexing, systems, loadIndexing]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return systems.filter((sys) => {
      const matchSearch = !s ||
        sys.name.toLowerCase().includes(s) ||
        sys.id.toLowerCase().includes(s) ||
        (sys.intended_purpose || "").toLowerCase().includes(s) ||
        (sys.business_owners || "").toLowerCase().includes(s);
      const matchLc = !lifecycleFilter || sys.lifecycle === lifecycleFilter;
      return matchSearch && matchLc;
    });
  }, [systems, search, lifecycleFilter]);

  async function openSystem(s: AISystem) {
    try {
      const fresh = await api.getSystem(s.id);
      setSelectedSystem(fresh);
      setDetailOpen(true);
    } catch (e) {
      showToast(`Failed to load system: ${(e as Error).message}`, true);
    }
  }

  function ownerLabel(username: string | null) {
    if (!username) return "—";
    const u = userMap[username];
    const full = [u?.firstName, u?.lastName].filter(Boolean).join(" ");
    return full || username;
  }

  // null → no documents (nothing to index); otherwise 0-100.
  function indexingPct(systemId: string): number | null {
    const e = indexing[systemId];
    if (!e || e.total === 0) return null;
    return Math.round((e.indexed / e.total) * 100);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-6 py-3">
        <Input type="text" className="w-64" placeholder="Search systems…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={cn(SELECT_CLASS, "w-auto")} value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)}>
          <option value="">All Lifecycle States</option>
          <option value="development">Development</option>
          <option value="testing">Testing</option>
          <option value="prod_ready">Production Ready</option>
          <option value="market">On Market</option>
          <option value="service">In Service</option>
          <option value="updated">Updated</option>
          <option value="decommissioned">Decommissioned</option>
        </select>
        <div className="flex-1" />
        <Button variant="ghost" onClick={loadSystems}><RefreshCw /> Refresh</Button>
      </div>

      <div className="px-6 py-5">
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>System</TableHead>
                <TableHead>Purpose of Use</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Contributors</TableHead>
                <TableHead>Indexing</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                    {systems.length === 0 ? 'No systems registered yet. Click "Register System" to add one.' : "No systems match the current filters."}
                  </TableCell>
                </TableRow>
              ) : filtered.map((s) => (
                <TableRow key={s.id} onClick={() => openSystem(s)} className="cursor-pointer">
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.id}</div>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <span className="line-clamp-2 text-[13px] text-muted-foreground">
                      {s.intended_purpose || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px]">{ownerLabel(s.business_owners)}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {s.contributors && s.contributors.length > 0 ? (
                      <span title={s.contributors.map(ownerLabel).join(", ")}>
                        {s.contributors.length} contributor{s.contributors.length > 1 ? "s" : ""}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {(() => {
                      const pct = indexingPct(s.id);
                      if (pct === null) return <span className="text-muted-foreground">—</span>;
                      return (
                        <span className={cn("font-medium", pct < 100 ? "text-[var(--brand)]" : "text-[var(--success)]")}>
                          {pct}%
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {s.org_role ? (
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs capitalize">{s.org_role}</span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell><LifecycleBadge lc={s.lifecycle} /></TableCell>
                  <TableCell><TierBadge tier={s.tier} workflowStatus={s.workflow_status} /></TableCell>
                  <TableCell className="text-[13px] text-muted-foreground"><FormattedDate iso={s.created_at} /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="View details"
                        onClick={() => openSystem(s)}
                      >
                        <Eye />
                      </Button>
                      {(() => {
                        const pct = indexingPct(s.id);
                        const busy = pct !== null && pct < 100;
                        return (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-[var(--brand)]"
                            title={busy ? `Documents are still being indexed (${pct}%)` : "Go to Assessments"}
                            disabled={busy}
                            onClick={() => goToAssessments(s.id)}
                          >
                            <ClipboardList />
                          </Button>
                        );
                      })()}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-[var(--danger-fg)]"
                        title={(() => {
                          if (mayApprove) return "Delete";
                          if (!mayWrite) return "Requires permission: systems:write";
                          if (s.workflow_status !== "draft") return "Cannot delete — workflow already started";
                          return "Delete";
                        })()}
                        disabled={!mayApprove && (!mayWrite || s.workflow_status !== "draft")}
                        onClick={async () => {
                          if (!confirm(`Delete "${s.name}"?\n\nThis action cannot be undone.`)) return;
                          try {
                            await api.deleteSystem(s.id);
                            showToast("System deleted");
                            loadSystems();
                          } catch (e) {
                            showToast(`Delete failed: ${(e as Error).message}`, true);
                          }
                        }}
                      ><Trash2 /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <SystemDetail
        open={detailOpen}
        system={selectedSystem}
        models={models}
        userMap={userMap}
        onClose={() => setDetailOpen(false)}
        onDelete={() => { setDetailOpen(false); loadSystems(); }}
        onUpdate={(updated) => {
          setSelectedSystem(updated);
          loadSystems();
        }}
      />
    </>
  );
}
