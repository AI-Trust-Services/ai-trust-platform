export interface AISystem {
  id: string;
  name: string;
}

export interface AuditEventSummary {
  id: string;
  created_at: string;
  actor_username: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ai_system_id: string;
  ai_system_name: string;
  source: string;
}

export interface AuditEventDetail extends AuditEventSummary {
  // A change entry is either a before/after diff (system/evidence actions) or a
  // flat value (e.g. llm_provider actions record changes as plain field→value).
  changes: Record<string, { before?: unknown; after?: unknown } | unknown>;
}

export interface AuditEventListResponse {
  total: number;
  items: AuditEventSummary[];
}

export interface CategoryStat {
  count: number;
  trend_pct: number | null;
}

export interface AuditStatsResponse {
  total: CategoryStat;
  system_events: CategoryStat;
  risk_and_compliance: CategoryStat;
}

export interface PermissionsResponse {
  username: string;
  permissions: string[];
}

export interface AuditFilters {
  ai_system_id: string;
  action: string;
  actor: string;
  resource_type: string;
  from: string;
  to: string;
  search: string;
}
