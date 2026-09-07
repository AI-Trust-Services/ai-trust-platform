import { useState, useEffect, useCallback } from "react";
import { Download, Loader2 } from "lucide-react";
import { api } from "../api/client";
import type { TimeseriesPoint, Kpis } from "../api/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";

const COLUMNS = [
  { key: "time",            label: "Time Bucket" },
  { key: "service",         label: "Service" },
  { key: "inference_count", label: "Inferences" },
  { key: "avg_latency_ms",  label: "Avg Latency (ms)" },
  { key: "input_tokens",    label: "Input Tokens" },
  { key: "output_tokens",   label: "Output Tokens" },
];

const WINDOWS = [
  { value: "15m", label: "Last 15 min" },
  { value: "1h",  label: "Last 1 hour" },
  { value: "6h",  label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

const ROW_PRESETS = ["All", "10", "25", "50", "100", "Custom"];
const PREVIEW_ROWS = 5;

interface ExportModalProps {
  onClose: () => void;
  currentService: string;
  currentWindow: string;
}

export default function ExportModal({ onClose, currentService, currentWindow }: ExportModalProps) {
  const [selectedCols, setSelectedCols] = useState<Set<string>>(
    new Set(COLUMNS.map((c) => c.key))
  );
  const [includeSummary, setIncludeSummary] = useState(true);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [rowPreset, setRowPreset] = useState("All");
  const [customRows, setCustomRows] = useState("");
  const [timeWindow, setTimeWindow] = useState(currentWindow);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchData = useCallback(async (w: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await api.getSignals(currentService, w);
      setTimeseries(data.timeseries || []);
      setKpis(data.kpis || {});
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Failed to load preview data.");
    } finally {
      setPreviewLoading(false);
    }
  }, [currentService]);

  useEffect(() => { fetchData(timeWindow); }, [timeWindow, fetchData]);

  function toggleCol(key: string) {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function getRowLimit(): number | null {
    if (rowPreset === "All") return null;
    if (rowPreset === "Custom") {
      const n = parseInt(customRows, 10);
      return !customRows || isNaN(n) || n < 1 ? null : n;
    }
    return parseInt(rowPreset, 10);
  }

  function buildRows(): unknown[][] {
    const cols = COLUMNS.filter((c) => selectedCols.has(c.key));
    const reversed = [...timeseries].reverse();
    const limit = getRowLimit();
    const sliced = limit != null ? reversed.slice(0, limit) : reversed;

    return sliced.map((r) =>
      cols.map((c) => {
        if (c.key === "time") return r.time;
        if (c.key === "service") return currentService || "All";
        if (c.key === "avg_latency_ms") return r.avg_latency_ms != null ? Number(r.avg_latency_ms).toFixed(0) : "";
        return (r as unknown as Record<string, unknown>)[c.key] ?? "";
      })
    );
  }

  function download() {
    const cols = COLUMNS.filter((c) => selectedCols.has(c.key));
    const dataRows = buildRows();
    const date = new Date().toISOString().slice(0, 10);
    const filename = `monitoring-${currentService || "all"}-${timeWindow}-${date}`;

    if (format === "json") {
      const json = dataRows.map((row) =>
        Object.fromEntries(cols.map((c, i) => [c.label, row[i]]))
      );
      const payload: Record<string, unknown> = { data: json };
      if (includeSummary) {
        payload.summary = {
          "Total Inferences": kpis?.total_inferences ?? "",
          "Avg Latency (ms)": kpis?.avg_latency_ms != null ? Number(kpis.avg_latency_ms).toFixed(0) : "",
          "Total Input Tokens": kpis?.total_input_tokens ?? "",
          "Total Output Tokens": kpis?.total_output_tokens ?? "",
        };
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      triggerDownload(blob, `${filename}.json`);
    } else {
      const rows: unknown[][] = [cols.map((c) => c.label), ...dataRows];
      if (includeSummary) {
        rows.push([], ["Summary"], ["Total Inferences", kpis?.total_inferences ?? ""],
          ["Avg Latency (ms)", kpis?.avg_latency_ms != null ? Number(kpis.avg_latency_ms).toFixed(0) : ""],
          ["Total Input Tokens", kpis?.total_input_tokens ?? ""],
          ["Total Output Tokens", kpis?.total_output_tokens ?? ""]
        );
      }
      const csv = rows.map((r) => (r as unknown[]).map((cell) => {
        const s = String(cell ?? "");
        return `"${s.replace(/"/g, '""')}"`;
      }).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      triggerDownload(blob, `${filename}.csv`);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const cols = COLUMNS.filter((c) => selectedCols.has(c.key));
  const previewRows = buildRows().slice(0, PREVIEW_ROWS);
  const totalRows = timeseries.length;
  const limit = getRowLimit();
  const exportCount = limit != null ? Math.min(limit, totalRows) : totalRows;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader>
          <DialogTitle>Export Data</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 p-6 sm:grid-cols-[220px_1fr]">
          {/* ── Controls ── */}
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>Columns</Label>
              {COLUMNS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={selectedCols.has(c.key)} onCheckedChange={() => toggleCol(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Include Summary</span>
              <Switch checked={includeSummary} onCheckedChange={setIncludeSummary} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as "csv" | "json")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Rows</Label>
              <Select value={rowPreset} onValueChange={setRowPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROW_PRESETS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              {rowPreset === "Custom" && (
                <Input
                  type="number"
                  min={1}
                  placeholder="Enter number of rows"
                  value={customRows}
                  onChange={(e) => setCustomRows(e.target.value)}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Time Window</Label>
              <Select value={timeWindow} onValueChange={setTimeWindow}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Preview ── */}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-sm font-semibold">Preview</div>
            {previewLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : previewError ? (
              <div className="py-6 text-sm text-[var(--danger-fg)]">
                {previewError}
              </div>
            ) : cols.length === 0 ? (
              <div className="py-6 text-sm text-muted-foreground">Select at least one column.</div>
            ) : (
              <>
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>{cols.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={cols.length} className="py-6 text-center text-muted-foreground">No data for this window.</TableCell>
                        </TableRow>
                      ) : previewRows.map((row, i) => (
                        <TableRow key={i}>
                          {(row as unknown[]).map((cell, j) => <TableCell key={j} className="text-xs">{String(cell)}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="text-xs text-muted-foreground">
                  Showing first {Math.min(PREVIEW_ROWS, exportCount)} of {exportCount} rows to export
                  {includeSummary && " + summary"}.
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={download}
            disabled={cols.length === 0 || previewLoading || !!previewError}
          >
            <Download /> Download {format.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
