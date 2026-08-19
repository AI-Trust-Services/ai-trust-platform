export type TierKey = "prohibited" | "gpai-systemic" | "gpai-standard" | "high" | "limited" | "minimal";
export type LifecycleKey = "development" | "testing" | "conformity" | "market" | "post-market" | "decommissioned";

export interface OverviewStats {
  total_systems: number;
  avg_compliance: number;
  fully_compliant: number;
  high_risk_on_market: number;
  prohibited_count: number;
  high_count: number;
  total_models: number;
  by_tier: Record<string, number>;
  by_lifecycle: Record<string, number>;
  by_type: Record<string, number>;
  compliance_by_tier: Record<string, number>;
  compliance_histogram: Record<string, number>;
  by_model_type: Record<string, number>;
  by_model_provider: Record<string, number>;
  recent: RecentSystem[];
  attention: AttentionSystem[];
}

export interface RecentSystem {
  id: string;
  name: string;
  tier: TierKey;
  lifecycle: LifecycleKey;
  compliance: number;
  created_at: string | null;
}

export interface AttentionSystem {
  id: string;
  name: string;
  tier: TierKey;
  lifecycle: LifecycleKey;
  compliance: number;
  // TODO: needs discussion — with N:M, a system can have multiple models.
  // Should this expose has_model: boolean, a list of model names, or nothing?
  // model_id: string | null;
  reason: string;
}

export type ChartType = "bar" | "doughnut" | "line" | "pie";
export type DataKey =
  | "by_tier" | "by_lifecycle" | "by_type"
  | "compliance_by_tier" | "compliance_histogram"
  | "by_model_type" | "by_model_provider"
  | "obligation_status" | "evidence_gap" | "framework_compliance"
  | "upcoming_deadlines" | "active_alerts";

export interface DashboardCard {
  id: string;
  title: string;
  type: ChartType | "kpi" | "table";
  dataKey?: DataKey;
}

export interface RecommendedChart {
  id: string;
  title: string;
  desc: string;
  type: ChartType | "kpi" | "table";
  dataKey?: DataKey;
  badge: string;
}

// --- Compliance stats types ---

export interface ObligationStatusCounts {
  applicable: number;
  in_progress: number;
  overdue: number;
  fulfilled: number;
  not_applicable: number;
}

export interface EvidenceGap {
  expired: number;
  expiring_soon: number;
  missing: number;
}

export interface FrameworkScore {
  framework_id: string;
  framework_name: string;
  total_obligations: number;
  fulfilled: number;
  score: number | null;
}

export interface RiskHeatCell {
  tier: string;
  tier_x: number;
  residual_risk_y: number;
  count: number;
}

export interface Deadline {
  type: "obligation" | "evidence";
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  ai_system_id: string | null;
  ai_system_name: string | null;
  framework_id: string | null;
}

export interface AlertEvent {
  id: string;
  rule_id: string;
  rule_name: string;
  category: string;
  severity: "error" | "warning" | "info";
  alert_type: string;
  description: string;
  value_at_trigger: number | null;
  triggered_at: string;
  entity_id: string;
  entity_type: string;
  entity_display_name: string;
}

export interface ComplianceStats {
  obligation_status: ObligationStatusCounts;
  evidence_gap: EvidenceGap;
  framework_compliance: FrameworkScore[];
  upcoming_deadlines: Deadline[];
  risk_heatmap: RiskHeatCell[];
}

export interface DateRange {
  preset: "7d" | "30d" | "90d";
  days: number;
}

