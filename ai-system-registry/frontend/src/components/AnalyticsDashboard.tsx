import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, Label, AreaChart, Area,
} from "recharts";
import {
  RotateCcw, Download, Plus, Loader2, MoreVertical,
  TrendingUp, AlertTriangle, Clock, FileWarning,
  Settings, Bookmark, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Types for analytics data
interface OverviewStats {
  total_systems: number;
  avg_compliance: number;
  by_tier: Record<string, number>;
}

interface ObligationStatusCounts {
  applicable: number;
  in_progress: number;
  overdue: number;
  fulfilled: number;
  not_applicable: number;
  blocked?: number;
  ready?: number;
}

interface EvidenceGap {
  expired: number;
  expiring_soon: number;
  missing: number;
}

interface FrameworkScore {
  framework_id: string;
  framework_name: string;
  total_obligations: number;
  fulfilled: number;
  not_started: number;
  in_progress: number;
  completed: number;
  score: number | null;
}

interface AlertEvent {
  id: string;
  rule_name: string;
  severity: "error" | "warning" | "info";
  description: string;
  triggered_at: string;
  entity_display_name: string;
}

interface ComplianceStats {
  obligation_status: ObligationStatusCounts;
  evidence_gap: EvidenceGap;
  framework_compliance: FrameworkScore[];
}

interface SavedView {
  id: string;
  name: string;
  isDefault?: boolean;
}

// Color palette
const TIER_COLORS: Record<string, string> = {
  prohibited: "#dc2626",
  "gpai-systemic": "#f97316",
  "gpai-standard": "#f59e0b",
  high: "#ef4444",
  limited: "#22c55e",
  minimal: "#3b82f6",
};

const TIER_LABELS: Record<string, string> = {
  prohibited: "Prohibited",
  "gpai-systemic": "GPAI",
  "gpai-standard": "GPAI Standard",
  high: "High-risk",
  limited: "Limited",
  minimal: "Minimal",
};

const OBLIGATION_COLORS: Record<string, string> = {
  overdue: "#dc2626",
  in_progress: "#f59e0b",
  blocked: "#9ca3af",
  ready: "#22c55e",
  fulfilled: "#3b82f6",
  not_applicable: "#e5e7eb",
  applicable: "#f97316",
};

// Evidence gap categories with colors
const EVIDENCE_GAP_ITEMS = [
  { key: "human_oversight", label: "Human oversight", color: "#dc2626" },
  { key: "training_data", label: "Training data governance", color: "#f59e0b" },
  { key: "bias_testing", label: "Bias & fairness testing", color: "#eab308" },
  { key: "incident_response", label: "Incident response", color: "#22c55e" },
  { key: "model_documentation", label: "Model documentation", color: "#3b82f6" },
];

interface AnalyticsDashboardProps {
  className?: string;
}

export default function AnalyticsDashboard({ className }: AnalyticsDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [complianceStats, setComplianceStats] = useState<ComplianceStats | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [dateRange, setDateRange] = useState("90d");
  const [savedView, setSavedView] = useState("compliance-operations");

  // Mock data for compliance trend
  const [complianceTrend] = useState([
    { date: "Apr 15", score: 58 },
    { date: "May 15", score: 60 },
    { date: "Jun 15", score: 62 },
    { date: "Jul 15", score: 64 },
  ]);

  // Mock saved views
  const savedViews: SavedView[] = [
    { id: "compliance-operations", name: "Compliance Operations", isDefault: true },
    { id: "executive-overview", name: "Executive Overview" },
    { id: "evidence-controls", name: "Evidence & Controls" },
    { id: "risk-obligations", name: "Risk & Obligations" },
  ];

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch overview stats from the overview API
      const OVERVIEW_API = "/api/overview/v1";
      const ALERTS_API = "/api/alerts/v1";

      const [statsRes, compRes, alertsRes] = await Promise.all([
        fetch(`${OVERVIEW_API}/stats`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${OVERVIEW_API}/compliance-stats?window_days=${dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90}`)
          .then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${ALERTS_API}/active`).then(r => r.ok ? r.json() : []).catch(() => []),
      ]);

      if (statsRes) setStats(statsRes);
      if (compRes) setComplianceStats(compRes);
      setAlerts(alertsRes.slice(0, 4));
    } catch (e) {
      console.error("Failed to load analytics", e);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derived data
  const tierData = stats?.by_tier
    ? Object.entries(stats.by_tier).map(([tier, count]) => ({
        name: TIER_LABELS[tier] || tier,
        value: count,
        tier,
      }))
    : [];

  const totalSystems = stats?.total_systems ?? 0;
  const avgCompliance = stats?.avg_compliance ?? 0;

  const obligationStatus = complianceStats?.obligation_status ?? {
    overdue: 0,
    in_progress: 0,
    blocked: 0,
    ready: 0,
    fulfilled: 0,
    applicable: 0,
    not_applicable: 0,
  };

  const totalObligations =
    (obligationStatus.overdue ?? 0) +
    (obligationStatus.in_progress ?? 0) +
    (obligationStatus.blocked ?? 0) +
    (obligationStatus.ready ?? 0) +
    (obligationStatus.applicable ?? 0);

  const frameworkData = complianceStats?.framework_compliance ?? [];

  // Evidence gaps - mock data based on typical categories
  const evidenceGaps = [
    { label: "Human oversight", value: 11, color: "#dc2626" },
    { label: "Training data governance", value: 8, color: "#f59e0b" },
    { label: "Bias & fairness testing", value: 7, color: "#eab308" },
    { label: "Incident response", value: 4, color: "#22c55e" },
    { label: "Model documentation", value: 3, color: "#3b82f6" },
  ];

  return (
    <div className={cn("flex flex-col gap-5 p-6", className)}>
      {/* Controls bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Saved View Selector */}
          <Select value={savedView} onValueChange={setSavedView}>
            <SelectTrigger className="w-[220px] gap-2">
              <Bookmark className="size-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {savedViews.map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {view.name}
                  {view.isDefault && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      Default
                    </Badge>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date Range */}
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[150px] gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={() => setLoading(true)}>
            <Settings className="mr-2 size-4" />
            Customize
          </Button>
          <Button variant="outline" size="sm">
            <Plus className="mr-2 size-4" />
            Add widget
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Download className="mr-2 size-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Widget Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* 1. Compliance Score Trend */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              <span className="mr-2 text-muted-foreground">1.</span>
              Compliance score trend
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="mb-1 text-xs text-muted-foreground">Average compliance score</div>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold">{avgCompliance}%</span>
              <span className="flex items-center text-sm text-green-600">
                <TrendingUp className="mr-1 size-4" />
                6 pp vs prior 90 days
              </span>
            </div>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={complianceTrend}>
                  <defs>
                    <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} hide />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#colorScore)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <button className="mt-2 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View full trend
              <ArrowRight className="size-4" />
            </button>
          </CardContent>
        </Card>

        {/* 2. Systems by Risk Tier */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              <span className="mr-2 text-muted-foreground">2.</span>
              Systems by risk tier
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-4">
              <div className="h-32 w-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={tierData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {tierData.map((entry) => (
                        <Cell key={entry.tier} fill={TIER_COLORS[entry.tier] || "#3b82f6"} />
                      ))}
                      <Label
                        content={({ viewBox }) => {
                          const { cx = 0, cy = 0 } = viewBox as { cx: number; cy: number };
                          return (
                            <>
                              <text
                                x={cx}
                                y={cy - 4}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className="fill-foreground text-2xl font-bold"
                              >
                                {totalSystems}
                              </text>
                              <text
                                x={cx}
                                y={cy + 12}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className="fill-muted-foreground text-[10px]"
                              >
                                Total
                              </text>
                            </>
                          );
                        }}
                      />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1 text-sm">
                {tierData.map((item) => (
                  <div key={item.tier} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="size-2 rounded-full"
                        style={{ backgroundColor: TIER_COLORS[item.tier] }}
                      />
                      <span>{item.name}</span>
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      {item.value} ({totalSystems > 0 ? Math.round((item.value / totalSystems) * 100) : 0}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <button className="mt-2 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View systems
              <ArrowRight className="size-4" />
            </button>
          </CardContent>
        </Card>

        {/* 3. Open Obligations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              <span className="mr-2 text-muted-foreground">3.</span>
              Open obligations
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="mb-1 text-xs text-muted-foreground">Total</div>
            <div className="mb-3 text-3xl font-bold">{totalObligations}</div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-red-500" />
                  <span>Overdue</span>
                </div>
                <span className="tabular-nums">
                  {obligationStatus.overdue ?? 0} ({totalObligations > 0 ? Math.round(((obligationStatus.overdue ?? 0) / totalObligations) * 100) : 0}%)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-amber-500" />
                  <span>In progress</span>
                </div>
                <span className="tabular-nums">
                  {obligationStatus.in_progress ?? 0} ({totalObligations > 0 ? Math.round(((obligationStatus.in_progress ?? 0) / totalObligations) * 100) : 0}%)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-gray-400" />
                  <span>Blocked</span>
                </div>
                <span className="tabular-nums">
                  {obligationStatus.blocked ?? 0} ({totalObligations > 0 ? Math.round(((obligationStatus.blocked ?? 0) / totalObligations) * 100) : 0}%)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-green-500" />
                  <span>Ready</span>
                </div>
                <span className="tabular-nums">
                  {obligationStatus.ready ?? 0} ({totalObligations > 0 ? Math.round(((obligationStatus.ready ?? 0) / totalObligations) * 100) : 0}%)
                </span>
              </div>
            </div>
            <button className="mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View obligations
              <ArrowRight className="size-4" />
            </button>
          </CardContent>
        </Card>

        {/* 4. Evidence Gaps */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              <span className="mr-2 text-muted-foreground">4.</span>
              Evidence gaps
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="mb-3 text-xs text-muted-foreground">Missing or expiring evidence</div>
            <div className="space-y-2">
              {evidenceGaps.map((gap) => (
                <div key={gap.label} className="flex items-center gap-2">
                  <span className="w-40 truncate text-sm">{gap.label}</span>
                  <div className="flex-1">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        backgroundColor: gap.color,
                        width: `${Math.min((gap.value / 15) * 100, 100)}%`,
                      }}
                    />
                  </div>
                  <span className="w-6 text-right text-sm tabular-nums">{gap.value}</span>
                </div>
              ))}
            </div>
            <button className="mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View all gaps
              <ArrowRight className="size-4" />
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Second Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 5. Assessment Completion by Framework */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              <span className="mr-2 text-muted-foreground">5.</span>
              Assessment completion by framework
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-full bg-gray-300" />
                <span>Not started</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-full bg-blue-500" />
                <span>In progress</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-full bg-green-500" />
                <span>Completed</span>
              </div>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={frameworkData.length > 0 ? frameworkData.map(f => ({
                    name: f.framework_name.replace(" AI ", "\n").split("\n")[0],
                    notStarted: f.not_started ?? Math.round(f.total_obligations * 0.16),
                    inProgress: f.in_progress ?? Math.round(f.total_obligations * 0.36),
                    completed: f.completed ?? f.fulfilled,
                    systems: f.total_obligations,
                  })) : [
                    { name: "EU AI Act", notStarted: 16, inProgress: 36, completed: 48, systems: 25 },
                    { name: "ISO 42001", notStarted: 14, inProgress: 32, completed: 54, systems: 28 },
                    { name: "NIST AI RMF", notStarted: 19, inProgress: 29, completed: 52, systems: 21 },
                  ]}
                  layout="vertical"
                  margin={{ left: 0, right: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => `${value}%`} />
                  <Bar dataKey="notStarted" stackId="a" fill="#d1d5db" name="Not started" />
                  <Bar dataKey="inProgress" stackId="a" fill="#3b82f6" name="In progress" />
                  <Bar dataKey="completed" stackId="a" fill="#22c55e" name="Completed" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              {(frameworkData.length > 0 ? frameworkData : [
                { framework_name: "EU AI Act", total_obligations: 25 },
                { framework_name: "ISO 42001", total_obligations: 28 },
                { framework_name: "NIST AI RMF", total_obligations: 21 },
              ]).map((f) => (
                <span key={f.framework_name}>{f.total_obligations} systems</span>
              ))}
            </div>
            <button className="mt-2 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View framework details
              <ArrowRight className="size-4" />
            </button>
          </CardContent>
        </Card>

        {/* 6. Active Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              <span className="mr-2 text-muted-foreground">6.</span>
              Active alerts
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(alerts.length > 0 ? alerts : [
                { id: "1", severity: "error" as const, rule_name: "Evidence expired", entity_display_name: "TalentMatch AI - Bias testing", triggered_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
                { id: "2", severity: "warning" as const, rule_name: "Assessment overdue", entity_display_name: "CrediScore AI Plus - EU AI Act", triggered_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() },
                { id: "3", severity: "info" as const, rule_name: "Control nearing expiry", entity_display_name: "SmartScheduler AI - Access control", triggered_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
                { id: "4", severity: "info" as const, rule_name: "New regulation update", entity_display_name: "EU AI Act guidance v1.1", triggered_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
              ]).map((alert) => {
                const severityConfig = {
                  error: { label: "High", color: "bg-red-100 text-red-700" },
                  warning: { label: "Medium", color: "bg-amber-100 text-amber-700" },
                  info: { label: "Low", color: "bg-blue-100 text-blue-700" },
                };
                const config = severityConfig[alert.severity];
                const timeAgo = formatTimeAgo(alert.triggered_at);

                return (
                  <div key={alert.id} className="flex items-start gap-3">
                    <Badge className={cn("shrink-0", config.color)}>{config.label}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{alert.rule_name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {alert.entity_display_name}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo}</span>
                  </div>
                );
              })}
            </div>
            <button className="mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View all alerts
              <ArrowRight className="size-4" />
            </button>
          </CardContent>
        </Card>

        {/* 7. Saved Views */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              <span className="mr-2 text-muted-foreground">7.</span>
              Saved views
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit</DropdownMenuItem>
                <DropdownMenuItem>Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {savedViews.map((view) => (
                <div
                  key={view.id}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50",
                    savedView === view.id && "border-primary bg-primary/5"
                  )}
                  onClick={() => setSavedView(view.id)}
                >
                  <div className="flex items-center gap-2">
                    <Bookmark className="size-4 text-muted-foreground" />
                    <span className="font-medium">{view.name}</span>
                    {view.isDefault && (
                      <Badge variant="secondary" className="text-xs">
                        Default
                      </Badge>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7">
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem>Set as default</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
            <button className="mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Manage views
              <ArrowRight className="size-4" />
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Hint */}
      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-muted">
          <span className="text-xs">i</span>
        </span>
        Drag widgets to rearrange. Resize from the bottom-right corner.
        <Button variant="ghost" size="icon" className="ml-auto size-6">
          <span className="sr-only">Dismiss</span>
          ×
        </Button>
      </div>
    </div>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
