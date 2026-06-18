export interface AlertEvent {
  id: string;
  rule_id: string;
  rule_name: string;
  category: "risk" | "compliance" | "observability" | "registry";
  severity: "error" | "warning" | "info";
  alert_type: "event" | "threshold";
  description: string;
  value_at_trigger: number | null;
  triggered_at: string;
  resolved_at: string | null;
  handled_at: string | null;
}

export interface AlertRule {
  id: string;
  name: string;
  category: "risk" | "compliance" | "observability" | "registry";
  severity: "error" | "warning" | "info";
  description: string;
  condition_type: string;
  threshold: number | null;
  source: string;
  alert_type: "event" | "threshold";
  enabled: boolean;
}

export interface AlertCount {
  count: number;
}
