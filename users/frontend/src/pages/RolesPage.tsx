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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {roles.map(role => (
            <div key={role.name} className="table-wrap" style={{ padding: "16px 20px" }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>
                {ROLE_LABELS[role.name] ?? role.name}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {role.permissions.map(p => (
                  <span key={p} className="badge badge-role perm-badge">{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
