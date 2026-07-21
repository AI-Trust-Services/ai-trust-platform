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
  model_id: string | null;
  reason: string;
}

export type ChartType = "bar" | "doughnut" | "line" | "pie";
export type DataKey =
  | "by_tier" | "by_lifecycle" | "by_type"
  | "compliance_by_tier" | "compliance_histogram"
  | "by_model_type" | "by_model_provider";

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
