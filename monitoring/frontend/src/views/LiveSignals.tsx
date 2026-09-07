import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { AlertTriangle, Copy, Download, Loader2, RotateCw } from "lucide-react";
import { api } from "../api/client";
import type { ServiceInfo, SignalsData, TimeseriesPoint } from "../api/client";
import { useToast } from "../App";
import { fmtDateTime } from "../utils";
import ExportModal from "../components/ExportModal";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { ChartTooltip, chartClass } from "@/components/ui/chart";

const STORAGE_KEY = "ai_trust_monitoring_filters_v1";
// Radix Select forbids empty-string item values — use a sentinel for "All Systems"
// and map it back to "" so the persisted filter + API calls stay byte-for-byte identical.
const ALL_SERVICES = "__all__";
// Second metric keeps its own categorical hue — never collapsed into the brand blue.
const LATENCY_COLOR = "#e05c00";
const WINDOWS = [
  { value: "15m", label: "Last 15 min" },
  { value: "1h",  label: "Last 1 hour" },
  { value: "6h",  label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

function loadFilters(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") || {}; } catch { return {}; }
}

function saveFilters(filters: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

function fmt(t: string) {
  return t ? t.slice(11, 16) : "";
}

export default function LiveSignals() {
  const saved = loadFilters();
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [selectedService, setSelectedService] = useState(saved.service || "");
  const [selectedWindow, setSelectedWindow] = useState(saved.window || "1h");
  const [signals, setSignals] = useState<SignalsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [staleThresholdMin, setStaleThresholdMin] = useState(3);
  const [page, setPage] = useState(0);
  const [showExport, setShowExport] = useState(false);
  const ROWS_PER_PAGE = 10;
  const filtersRef = useRef({ service: saved.service || "", window: saved.window || "1h" });
  const showToast = useToast();

  // Keep ref in sync so the interval always reads the latest filters without restarting
  useEffect(() => {
    filtersRef.current = { service: selectedService, window: selectedWindow };
  }, [selectedService, selectedWindow]);

  const loadServices = useCallback(async () => {
    try {
      const data = await api.getServices();
      setServices(data);
    } catch (e) {
      showToast(`Failed to load services: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  const loadSignals = useCallback(async (service: string, window: string) => {
    setLoading(true);
    try {
      const data = await api.getSignals(service, window);
      setSignals(data);
      if (data.timeseries?.length > 0) {
        const last = data.timeseries[data.timeseries.length - 1].time;
        // ClickHouse returns timestamps without timezone suffix — treat as UTC.
        const lastUtcMs = new Date(last.replace(" ", "T") + "Z").getTime();
        const staleMs: Record<string, number> = { "15m": 3, "1h": 3, "6h": 10, "24h": 20 };
        const thresholdMin = staleMs[window] ?? 5;
        setStaleThresholdMin(thresholdMin);
        setStale((Date.now() - lastUtcMs) > thresholdMin * 60 * 1000);
      } else {
        setStale(false);
        setStaleThresholdMin(3);
      }
    } catch (e) {
      showToast(`Failed to load signals: ${(e as Error).message}`, true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Initial load + stable interval — never restarts when filters change
  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    loadSignals(filtersRef.current.service, filtersRef.current.window);
    const id = setInterval(
      () => loadSignals(filtersRef.current.service, filtersRef.current.window),
      5000,
    );
    return () => clearInterval(id);
  }, [loadSignals]); // loadSignals is stable (no filter deps); interval never restarts

  // Reload immediately when filters change
  useEffect(() => {
    loadSignals(selectedService, selectedWindow);
  }, [selectedService, selectedWindow, loadSignals]);

  function handleServiceChange(v: string) {
    const val = v === ALL_SERVICES ? "" : v;
    setSelectedService(val);
    setPage(0);
    saveFilters({ service: val, window: selectedWindow });
  }

  function handleWindowChange(v: string) {
    setSelectedWindow(v);
    setPage(0);
    saveFilters({ service: selectedService, window: v });
  }

  const kpis = signals?.kpis ?? null;
  const timeseries = signals?.timeseries ?? [];
  const k = kpis;

  function copyChartData(dataKey: keyof TimeseriesPoint, header: string) {
    const tsv = [header, ...timeseries.map((r) => {
      const val = r[dataKey];
      return `${r.time}\t${val ?? ""}`;
    })].join("\n");
    navigator.clipboard.writeText(tsv).then(() => showToast("Copied to clipboard")).catch(() => showToast("Failed to copy to clipboard", true));
  }

  const pagedRows = [...timeseries].reverse().slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  return (
    <>
      <div className="flex flex-col gap-4 p-6">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedService || ALL_SERVICES} onValueChange={handleServiceChange}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SERVICES}>All Systems</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.system_id ?? s.service_name} value={s.system_id ?? s.service_name}>
                  {s.display_name ?? s.service_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedWindow} onValueChange={handleWindowChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} disabled={timeseries.length === 0}>
            <Download /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadSignals(selectedService, selectedWindow)} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RotateCw />} Refresh
          </Button>
        </div>

        {stale && (
          <div className="flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-bg)] px-4 py-2.5 text-[13px] text-[var(--warning-fg)]">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Signal data may be stale — last datapoint was more than {staleThresholdMin} minutes ago.</span>
          </div>
        )}

        {/* ── KPI grid ── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Inferences</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{k?.total_inferences != null ? k.total_inferences.toLocaleString() : "—"}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Avg Latency</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{k?.avg_latency_ms != null ? `${k.avg_latency_ms.toFixed(0)} ms` : "—"}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Input Tokens</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{k?.total_input_tokens != null ? k.total_input_tokens.toLocaleString() : "—"}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Output Tokens</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{k?.total_output_tokens != null ? k.total_output_tokens.toLocaleString() : "—"}</div>
          </Card>
        </div>

        {/* ── Charts ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Inference Count over Time</span>
              <Button variant="ghost" size="sm" onClick={() => copyChartData("inference_count", "Time\tInference Count")}>
                <Copy /> Copy
              </Button>
            </div>
            <div className={chartClass}>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <XAxis dataKey="time" tickFormatter={fmt} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltip labelFormatter={(l) => fmt(String(l))} />} />
                  <Line type="monotone" dataKey="inference_count" name="Inference Count" stroke="var(--brand)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Avg Latency (ms) over Time</span>
              <Button variant="ghost" size="sm" onClick={() => copyChartData("avg_latency_ms", "Time\tAvg Latency (ms)")}>
                <Copy /> Copy
              </Button>
            </div>
            <div className={chartClass}>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <XAxis dataKey="time" tickFormatter={fmt} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltip labelFormatter={(l) => fmt(String(l))} />} />
                  <Line type="monotone" dataKey="avg_latency_ms" name="Avg Latency (ms)" stroke={LATENCY_COLOR} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* ── Inference Breakdown ── */}
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Inference Breakdown</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time Bucket</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Inferences</TableHead>
                <TableHead>Avg Latency (ms)</TableHead>
                <TableHead>Input Tokens</TableHead>
                <TableHead>Output Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timeseries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No inference data for this window.</TableCell>
                </TableRow>
              ) : pagedRows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{row.time}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{selectedService || "All"}</TableCell>
                  <TableCell className="text-[13px] tabular-nums">{row.inference_count?.toLocaleString()}</TableCell>
                  <TableCell className="text-[13px] tabular-nums">{row.avg_latency_ms != null ? `${Number(row.avg_latency_ms).toFixed(0)} ms` : "—"}</TableCell>
                  <TableCell className="text-[13px] tabular-nums">{row.input_tokens?.toLocaleString()}</TableCell>
                  <TableCell className="text-[13px] tabular-nums">{row.output_tokens?.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {timeseries.length > ROWS_PER_PAGE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span>{page * ROWS_PER_PAGE + 1}–{Math.min((page + 1) * ROWS_PER_PAGE, timeseries.length)} of {timeseries.length}</span>
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => { if (page > 0) setPage((p) => p - 1); }}
                      aria-disabled={page === 0}
                      className={page === 0 ? "pointer-events-none opacity-50" : ""}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => { if ((page + 1) * ROWS_PER_PAGE < timeseries.length) setPage((p) => p + 1); }}
                      aria-disabled={(page + 1) * ROWS_PER_PAGE >= timeseries.length}
                      className={(page + 1) * ROWS_PER_PAGE >= timeseries.length ? "pointer-events-none opacity-50" : ""}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </Card>

        {/* ── Services ── */}
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Services</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>System</TableHead>
                <TableHead>Total Spans</TableHead>
                <TableHead>Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No registered systems with telemetry yet.</TableCell>
                </TableRow>
              ) : services.map((s) => (
                <TableRow key={s.system_id ?? s.service_name}>
                  <TableCell className="font-medium">
                    {s.display_name ?? s.service_name}
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{s.service_name}</span>
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums">{s.total_spans?.toLocaleString()}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{fmtDateTime(s.last_seen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {showExport && (
        <ExportModal
          onClose={() => setShowExport(false)}
          currentService={selectedService}
          currentWindow={selectedWindow}
        />
      )}
    </>
  );
}
