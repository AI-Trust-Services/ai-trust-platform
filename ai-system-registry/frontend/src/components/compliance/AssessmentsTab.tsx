/**
 * AssessmentsTab — Embedded assessments view for SystemWorkspace.
 * Displays assessments filtered by the current AI system.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { ClipboardList, CheckCircle2, Clock, FileText, RotateCw, ExternalLink } from "lucide-react";
import { api } from "../../api/client";
import { navigateToPath } from "../../hooks/useLuigi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Assessment, AssessmentDetail, Framework } from "../../types";
import { ASSESSMENT_STATUS_META, fmtDate, humanize, getStatusColor, getScoreColor } from "../../utils/compliance";

const ALL = "__all__";

interface AssessmentsTabProps {
  systemId: string;
  systemName: string;
}

export default function AssessmentsTab({ systemId, systemName }: AssessmentsTabProps) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [frameworksById, setFrameworksById] = useState<Record<string, Framework>>({});
  const [selected, setSelected] = useState<AssessmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [assess, fw] = await Promise.all([
        api.compliance.getAssessments(systemId),
        api.compliance.getFrameworks(),
      ]);
      setAssessments(assess);
      setFrameworksById(Object.fromEntries(fw.map((f) => [f.id, f])));
    } catch (e) {
      console.error("Failed to load assessments:", e);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(a: Assessment) {
    try {
      const detail = await api.compliance.getAssessment(a.id);
      setSelected(detail);
    } catch (e) {
      console.error("Failed to load assessment detail:", e);
    }
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return assessments.filter((a) => {
      const matchSearch = !s || a.title.toLowerCase().includes(s);
      return matchSearch && (!statusFilter || a.status === statusFilter);
    });
  }, [assessments, search, statusFilter]);

  const kpis = useMemo(() => ({
    total: assessments.length,
    approved: assessments.filter((a) => a.status === "approved").length,
    submitted: assessments.filter((a) => a.status === "submitted" || a.status === "under_review").length,
    draft: assessments.filter((a) => a.status === "draft").length,
  }), [assessments]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RotateCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Assessments</h2>
          <p className="text-sm text-muted-foreground">Compliance assessments for {systemName}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RotateCw className="mr-2 size-4" /> Refresh
          </Button>
          <Button size="sm" onClick={() => navigateToPath(`/home/assessments`)}>
            <ExternalLink className="mr-2 size-4" /> Open in Compliance
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-gray-100">
              <ClipboardList className="size-5 text-gray-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-green-100">
              <CheckCircle2 className="size-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.approved}</p>
              <p className="text-xs text-muted-foreground">Approved</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100">
              <Clock className="size-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.submitted}</p>
              <p className="text-xs text-muted-foreground">In Review</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-gray-100">
              <FileText className="size-5 text-gray-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.draft}</p>
              <p className="text-xs text-muted-foreground">Draft</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search assessments…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter || ALL} onValueChange={(v) => setStatusFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {Object.entries(ASSESSMENT_STATUS_META).map(([v, m]) => (
              <SelectItem key={v} value={v}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Assessment</TableHead>
              <TableHead>Framework</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {assessments.length === 0
                    ? "No assessments yet. Create one in the Compliance module."
                    : "No assessments match your filters."}
                </TableCell>
              </TableRow>
            ) : filtered.map((a) => (
              <TableRow
                key={a.id}
                className="cursor-pointer"
                onClick={() => openDetail(a)}
              >
                <TableCell>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.id}</div>
                </TableCell>
                <TableCell>{frameworksById[a.framework_id]?.name ?? a.framework_id}</TableCell>
                <TableCell>{humanize(a.type)}</TableCell>
                <TableCell>
                  <Badge className={getStatusColor(ASSESSMENT_STATUS_META[a.status]?.cls || "")}>
                    {ASSESSMENT_STATUS_META[a.status]?.label ?? a.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {a.score !== null ? (
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${getScoreColor(a.score)}`}
                          style={{ width: `${a.score}%` }}
                        />
                      </div>
                      <span className="text-sm">{a.score}%</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Detail Panel (simplified inline) */}
      {selected && (
        <Card className="mt-4 p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">{selected.title}</h3>
              <p className="text-sm text-muted-foreground">{frameworksById[selected.framework_id]?.name}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>×</Button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge className={getStatusColor(ASSESSMENT_STATUS_META[selected.status]?.cls || "")}>
                {ASSESSMENT_STATUS_META[selected.status]?.label}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Obligations</p>
              <p>{selected.fulfilled_count} / {selected.obligation_count} fulfilled</p>
            </div>
            <div>
              <p className="text-muted-foreground">Score</p>
              <p>{selected.score !== null ? `${selected.score}%` : "—"}</p>
            </div>
          </div>
          {selected.notes && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">Notes</p>
              <p className="mt-1 text-sm">{selected.notes}</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
