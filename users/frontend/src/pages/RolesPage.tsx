import { useState, useEffect } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { RoleInfo } from "../types";

const ROLE_LABELS: Record<string, string> = {
  platform_administrator: "Platform Administrator",
  ai_engineer: "AI Engineer",
  business_owner: "Business Owner",
  ai_compliance_officer: "AI Compliance Officer",
  auditor: "Auditor",
  executive: "Executive",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  platform_administrator: "Full access to all features and user management.",
  ai_engineer: "Register and manage AI systems, view monitoring and alerts.",
  business_owner: "Approve assessments and evidence, read-only access to systems.",
  ai_compliance_officer: "Manage compliance assessments, obligations, controls and evidence.",
  auditor: "Read-only access to systems, assessments, evidence and monitoring.",
  executive: "High-level read access to systems and monitoring dashboards.",
};

const PERMISSION_LABELS: Record<string, string> = {
  "systems:read":        "View AI systems",
  "systems:write":       "Create & edit AI systems",
  "assessments:read":    "View assessments",
  "assessments:write":   "Create & edit assessments",
  "assessments:approve": "Approve assessments",
  "evidence:read":       "View evidence",
  "evidence:write":      "Upload & edit evidence",
  "evidence:approve":    "Approve evidence",
  "alerts:read":         "View alerts",
  "alerts:handle":       "Handle & resolve alerts",
  "alerts:manage_rules": "Manage alert rules",
  "monitoring:read":     "View monitoring data",
  "iam:manage":          "Manage users & roles",
};

export default function RolesPage(): JSX.Element {
  const showToast = useToast();
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getRoleDetails()
      .then(data => { setRoles(data); setError(null); })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [showToast]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Roles &amp; Permissions</div>
          <div className="page-subtitle">Built-in roles and the permissions each grants</div>
        </div>
      </div>

      {loading && <div className="empty">Loading…</div>}

      {!loading && error && (
        <div className="error-banner">Failed to load roles: {error}</div>
      )}

      {!loading && !error && roles.length === 0 && (
        <div className="empty">No roles found.</div>
      )}

      {!loading && !error && roles.length > 0 && (
        <div className="roles-grid">
          {roles.map(role => (
            <div key={role.name} className="role-card">
              <div className="role-card-header">
                <div className="role-card-name">{ROLE_LABELS[role.name] ?? role.name}</div>
                {ROLE_DESCRIPTIONS[role.name] && (
                  <div className="role-card-desc">{ROLE_DESCRIPTIONS[role.name]}</div>
                )}
              </div>
              <ul className="perm-list">
                {role.permissions.map(p => (
                  <li key={p} className="perm-item">
                    <span className="perm-check">✓</span>
                    {PERMISSION_LABELS[p] ?? p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
