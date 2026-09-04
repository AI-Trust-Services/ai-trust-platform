import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  ChevronRight,
  X,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
  Cpu,
  ShieldCheck,
} from "lucide-react";
import { api, normalizeDateFrom, normalizeDateTo } from "../api/client";
import type {
  AuditEventSummary,
  AuditEventDetail,
  AuditStatsResponse,
  AuditFilters,
  AISystem,
} from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import Pagination from "../components/Pagination";

// ── Constants ─────────────────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  "system.registered": "Registered",
  "system.updated": "Updated",
  "system.deleted": "Deleted",
  "system.reclassified": "Reclassified",
  "assessment.created": "Created",
  "assessment.submitted": "Submitted",
  "assessment.approved": "Approved",
  "evidence.uploaded": "Uploaded",
  "evidence.approved": "Approved",
  "evidence.rejected": "Rejected",
};

const ACTION_COLORS: Record<string, string> = {
  "system.registered": "bg-[#d5f5e3] text-[#1a5c35]",
  "system.updated": "bg-[#e8f0fb] text-[#0a4a9e]",
  "system.deleted": "bg-[#fde8e8] text-[#8b0000]",
  "system.reclassified": "bg-[#fde8d0] text-[#8b3a00]",
  "assessment.created": "bg-[#d5f5e3] text-[#1a5c35]",
  "assessment.submitted": "bg-[#e8f0fb] text-[#0a4a9e]",
  "assessment.approved": "bg-[#d5f5e3] text-[#1a5c35]",
  "evidence.uploaded": "bg-[#f0e8fb] text-[#5a0a9e]",
  "evidence.approved": "bg-[#d5f5e3] text-[#1a5c35]",
  "evidence.rejected": "bg-[#fde8e8] text-[#8b0000]",
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  ai_system: "AI System",
  assessment: "Assessment",
  evidence: "Evidence",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtTrend(pct: number | null): string {
  if (pct === null) return "";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct}%`;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  count: number | null;
  trend_pct: number | null;
  Icon: React.ElementType;
  color: string;
}

function StatCard({ label, count, trend_pct, Icon, color }: StatCardProps) {
  const trendPositive = trend_pct !== null && trend_pct >= 0;
  return (
    <div className="flex flex-1 min-w-[140px] flex-col gap-1.5 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className="flex size-8 items-center justify-center rounded-lg"
          style={{ background: color + "22" }}
        >
          <Icon className="size-4" style={{ color }} />
        </span>
        <span className="text-xs font-medium text-muted-foreground leading-tight">{label}</span>
      </div>
      {count === null ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <div className="flex items-end justify-between">
          <span className="text-2xl font-bold tracking-tight">{count.toLocaleString()}</span>
          {trend_pct !== null && (
            <span
              className={cn(
                "text-xs font-semibold",
                trendPositive ? "text-[#1a5c35]" : "text-[#8b0000]"
              )}
            >
              {fmtTrend(trend_pct)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Changes Diff ──────────────────────────────────────────────────────────────

function ChangesDiff({ changes }: { changes: AuditEventDetail["changes"] }) {
  const entries = Object.entries(changes);
  if (!entries.length) return <span className="text-xs text-muted-foreground">No changes recorded</span>;

  return (
    <div className="flex flex-col gap-2">
      {entries.map(([field, diff]) => (
        <div key={field} className="rounded-md border border-border bg-muted/40 p-2.5">
          <div className="mb-1 text-xs font-semibold text-foreground capitalize">
            {field.replace(/_/g, " ")}
          </div>
          <div className="flex flex-col gap-0.5 text-xs">
            {diff.before !== undefined && (
              <div className="flex gap-1.5 items-start">
                <span className="shrink-0 w-12 text-[#8b0000] font-medium">Before:</span>
                <span className="font-mono text-muted-foreground break-all">
                  {diff.before === null ? "—" : String(diff.before)}
                </span>
              </div>
            )}
            {diff.after !== undefined && (
              <div className="flex gap-1.5 items-start">
                <span className="shrink-0 w-12 text-[#1a5c35] font-medium">After:</span>
                <span className="font-mono text-foreground break-all">
                  {diff.after === null ? "—" : String(diff.after)}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  event: AuditEventDetail | null;
  loading: boolean;
  onClose: () => void;
}

function DetailPanel({ event, loading, onClose }: DetailPanelProps) {
  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex h-11 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-semibold">Event Detail</span>
        <button
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded hover:bg-muted text-muted-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : !event ? (
          <p className="text-xs text-muted-foreground">Select an event to view details.</p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Event ID</span>
              <span className="font-mono text-xs">{event.id}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Time</span>
              <span>{fmtDateTime(event.created_at)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Action</span>
              <Badge className={cn("w-fit text-xs", ACTION_COLORS[event.action] ?? "bg-muted text-foreground")}>
                {ACTION_LABELS[event.action] ?? event.action}
              </Badge>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Actor</span>
              <span>{event.actor_username}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Resource Type</span>
              <span>{RESOURCE_TYPE_LABELS[event.resource_type] ?? event.resource_type}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Resource ID</span>
              <span className="font-mono text-xs">{event.resource_id}</span>
            </div>
            {event.ai_system_name && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">AI System</span>
                <span>{event.ai_system_name}</span>
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Source</span>
              <span className="capitalize">{event.source}</span>
            </div>
            {Object.keys(event.changes).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Changes</span>
              <ChangesDiff changes={event.changes} />
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function AuditLogs() {
  // Stats
  const [stats, setStats] = useState<AuditStatsResponse | null>(null);

  // AI systems for filter dropdown
  const [systems, setSystems] = useState<AISystem[]>([]);

  // Event list
  const [events, setEvents] = useState<AuditEventSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<"desc" | "asc">("desc");

  // Filters
  const [search, setSearch] = useState("");
  const [filterSystem, setFilterSystem] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterActor, setFilterActor] = useState("");
  const [filterResourceType, setFilterResourceType] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  function buildFilters(): Partial<AuditFilters> & { limit: number; offset: number; sort: string } {
    const f: Partial<AuditFilters> & { limit: number; offset: number; sort: string } = {
      limit: pageSize,
      offset: page * pageSize,
      sort,
    };
    if (search) f.search = search;
    if (filterSystem) f.ai_system_id = filterSystem;
    if (filterAction) f.action = filterAction;
    if (filterActor) f.actor = filterActor;
    if (filterResourceType) f.resource_type = filterResourceType;
    if (filterFrom) f.from = normalizeDateFrom(filterFrom);
    if (filterTo) f.to = normalizeDateTo(filterTo);
    return f;
  }

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.listEvents(buildFilters());
      setEvents(resp.items);
      setTotal(resp.total);
    } catch {
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sort, search, filterSystem, filterAction, filterActor, filterResourceType, filterFrom, filterTo]);

  const loadStats = useCallback(async () => {
    try {
      const s = await api.getStats(
        filterFrom ? normalizeDateFrom(filterFrom) : undefined,
        filterTo ? normalizeDateTo(filterTo) : undefined,
      );
      setStats(s);
    } catch {
      setStats(null);
    }
  }, [filterFrom, filterTo]);

  useEffect(() => {
    loadEvents();
    loadStats();
  }, [loadEvents, loadStats]);

  useEffect(() => {
    const filters: Record<string, string> = {};
    if (filterAction) filters.action = filterAction;
    if (filterResourceType) filters.resource_type = filterResourceType;
    if (filterFrom) filters.from = normalizeDateFrom(filterFrom);
    if (filterTo) filters.to = normalizeDateTo(filterTo);
    if (search) filters.search = search;
    api.getSystems(filters).then((s) => {
      setSystems(s);
      if (filterSystem && !s.find((x) => x.id === filterSystem)) {
        setFilterSystem("");
      }
    }).catch(() => {});
  }, [filterAction, filterResourceType, filterFrom, filterTo, search]);

  // Debounce search input
  function handleSearchChange(val: string) {
    setSearch(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setPage(0);
    }, 300);
  }

  function applyFilter() {
    setPage(0);
  }

  function clearFilters() {
    setFilterSystem("");
    setFilterAction("");
    setFilterActor("");
    setFilterResourceType("");
    setFilterFrom("");
    setFilterTo("");
    setSearch("");
    setPage(0);
  }

  async function selectEvent(id: string) {
    if (selectedId === id) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    setSelectedId(id);
    setDetailLoading(true);
    try {
      setDetail(await api.getEvent(id));
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function toggleSort() {
    setSort((s) => (s === "desc" ? "asc" : "desc"));
    setPage(0);
  }

  const hasFilters =
    search || filterSystem || filterAction || filterActor || filterResourceType || filterFrom || filterTo;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats row */}
      <div className="flex flex-wrap gap-3 px-6 py-4 border-b border-border">
        <StatCard
          label="Total Events"
          count={stats?.total.count ?? null}
          trend_pct={stats?.total.trend_pct ?? null}
          Icon={Clock}
          color="#1147E9"
        />
        <StatCard
          label="System Events"
          count={stats?.system_events.count ?? null}
          trend_pct={stats?.system_events.trend_pct ?? null}
          Icon={Cpu}
          color="#0a8a4e"
        />
        <StatCard
          label="Risk & Compliance"
          count={stats?.risk_and_compliance.count ?? null}
          trend_pct={stats?.risk_and_compliance.trend_pct ?? null}
          Icon={ShieldCheck}
          color="#e9a922"
        />
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-end gap-2 border-b border-border bg-card px-6 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs w-[200px]"
            placeholder="Search events, actors, systems…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <Select value={filterAction || "__all__"} onValueChange={(v) => { setFilterAction(v === "__all__" ? "" : v); applyFilter(); }}>
          <SelectTrigger className="h-8 text-xs w-[160px]">
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Actions</SelectItem>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterSystem || "__all__"} onValueChange={(v) => { setFilterSystem(v === "__all__" ? "" : v); applyFilter(); }}>
          <SelectTrigger className="h-8 text-xs w-[160px]">
            <SelectValue placeholder="All Systems" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Systems</SelectItem>
            {systems.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterResourceType || "__all__"} onValueChange={(v) => { setFilterResourceType(v === "__all__" ? "" : v); applyFilter(); }}>
          <SelectTrigger className="h-8 text-xs w-[140px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Types</SelectItem>
            <SelectItem value="ai_system">AI System</SelectItem>
            <SelectItem value="assessment">Assessment</SelectItem>
            <SelectItem value="evidence">Evidence</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Input
            className="h-8 text-xs w-[130px]"
            type="date"
            title="From"
            value={filterFrom}
            onChange={(e) => { setFilterFrom(e.target.value); applyFilter(); }}
          />
          <span className="text-xs text-muted-foreground">—</span>
          <Input
            className="h-8 text-xs w-[130px]"
            type="date"
            title="To"
            value={filterTo}
            onChange={(e) => { setFilterTo(e.target.value); applyFilter(); }}
          />
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            <X className="size-3" />
            Clear
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{total.toLocaleString()} events</span>
          <Button variant="outline" size="sm" className="h-8" onClick={() => { loadEvents(); loadStats(); }}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Table + Detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr>
                <th className="border-b border-border px-4 py-2.5 text-left font-semibold text-muted-foreground w-[160px]">
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={toggleSort}>
                    Time
                    {sort === "desc" ? (
                      <ArrowDown className="size-3" />
                    ) : sort === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowUpDown className="size-3" />
                    )}
                  </button>
                </th>
                <th className="border-b border-border px-4 py-2.5 text-left font-semibold text-muted-foreground w-[120px]">Action</th>
                <th className="border-b border-border px-4 py-2.5 text-left font-semibold text-muted-foreground w-[180px]">AI System</th>
                <th className="border-b border-border px-4 py-2.5 text-left font-semibold text-muted-foreground w-[120px]">Actor</th>
                <th className="border-b border-border px-4 py-2.5 text-left font-semibold text-muted-foreground w-[100px]">Resource</th>
                <th className="border-b border-border px-4 py-2.5 text-left font-semibold text-muted-foreground w-[28px]"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="border-b border-border px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-20 text-center text-muted-foreground">
                    {hasFilters
                      ? "No events match the current filters."
                      : "No audit events recorded yet."}
                  </td>
                </tr>
              ) : (
                events.map((ev) => {
                  const isSelected = selectedId === ev.id;
                  return (
                    <tr
                      key={ev.id}
                      onClick={() => selectEvent(ev.id)}
                      className={cn(
                        "cursor-pointer border-b border-border transition-colors",
                        isSelected
                          ? "bg-[#e8f0fb]"
                          : "hover:bg-muted/50"
                      )}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {fmtDateTime(ev.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          className={cn(
                            "text-[11px]",
                            ACTION_COLORS[ev.action] ?? "bg-muted text-foreground"
                          )}
                        >
                          {ACTION_LABELS[ev.action] ?? ev.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 max-w-[180px] truncate" title={ev.ai_system_name}>
                        {ev.ai_system_name || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 max-w-[120px] truncate" title={ev.actor_username}>
                        {ev.actor_username}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-muted-foreground">
                          {RESOURCE_TYPE_LABELS[ev.resource_type] ?? ev.resource_type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <ChevronRight
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform",
                            isSelected && "rotate-90 text-foreground"
                          )}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <Pagination
            page={page + 1}
            pageSize={pageSize}
            total={total}
            onPageChange={(p) => setPage(p - 1)}
            onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
          />
        </div>

        {/* Detail panel */}
        {selectedId && (
          <DetailPanel
            event={detail}
            loading={detailLoading}
            onClose={() => { setSelectedId(null); setDetail(null); }}
          />
        )}
      </div>
    </div>
  );
}
