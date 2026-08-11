import { useState, useEffect, useCallback } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import { CustomRoleModal } from "../components/CustomRoleModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { CustomRole, RoleInfo } from "../types";
import { usePermissions } from "../hooks/usePermissions";
import { ROLE_LABELS } from "../constants";

const ROLE_DESCRIPTIONS: Record<string, string> = {
  platform_administrator: "Full access to all features and user management.",
  ai_engineer: "Register and manage AI systems, view monitoring and alerts.",
  business_owner: "Approve assessments and evidence, read-only access to systems.",
  ai_compliance_officer: "Manage compliance assessments, obligations, controls and evidence.",
  auditor: "Read-only access to systems, assessments, evidence and monitoring.",
  executive: "High-level read access to systems and monitoring dashboards.",
};

const PERMISSION_LABELS: Record<string, string> = {
  "systems:read": "View AI systems",
  "systems:write": "Create & edit AI systems",
  "assessments:read": "View assessments",
  "assessments:write": "Create & edit assessments",
  "assessments:approve": "Approve assessments",
  "evidence:read": "View evidence",
  "evidence:write": "Upload & edit evidence",
  "evidence:approve": "Approve evidence",
  "alerts:read": "View alerts",
  "alerts:handle": "Handle & resolve alerts",
  "alerts:manage_rules": "Manage alert rules",
  "monitoring:read": "View monitoring data",
  "iam:manage": "Manage users & roles",
};

export default function RolesPage() {
  const showToast = useToast();
  const { can } = usePermissions();
  const isAdmin = can("iam:manage");

  const [builtins, setBuiltins] = useState<RoleInfo[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomRole | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([api.getRoleDetails(), api.getCustomRoles()]);
      setBuiltins(b);
      setCustomRoles(c);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteCustomRole(deleteTarget.id);
      setCustomRoles(prev => prev.filter(r => r.id !== deleteTarget.id));
      showToast("Role deleted.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setDeleteTarget(null);
    }
  }

  function handleSaved(role: CustomRole) {
    setCustomRoles(prev => {
      const idx = prev.findIndex(r => r.id === role.id);
      return idx >= 0 ? prev.map(r => r.id === role.id ? role : r) : [...prev, role];
    });
    setModalOpen(false);
    setEditTarget(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Roles &amp; Permissions</div>
          <div className="page-subtitle">Built-in roles and custom roles for this platform</div>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => { setEditTarget(null); setModalOpen(true); }}>
            + Create Role
          </button>
        )}
      </div>

      {loading && <div className="empty">Loading…</div>}

      {!loading && error && (
        <div className="error-banner">Failed to load roles: {error}</div>
      )}

      {!loading && !error && (
        <>
          <div className="roles-section-title">Built-in Roles</div>
          <div className="roles-grid" style={{ marginBottom: 32 }}>
            {builtins.map(role => (
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

          <div className="roles-section-title">
            Custom Roles
            <span className="roles-section-count">{customRoles.length}</span>
          </div>
          {customRoles.length === 0 ? (
            <div className="empty" style={{ padding: "32px 0" }}>
              No custom roles yet.{isAdmin && " Click \"+ Create Role\" to add one."}
            </div>
          ) : (
            <div className="roles-grid">
              {customRoles.map(role => (
                <div key={role.id} className="role-card role-card-custom">
                  <div className="role-card-header">
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <div className="role-card-name">{role.name}</div>
                        {role.description && (
                          <div className="role-card-desc">{role.description}</div>
                        )}
                      </div>
                      {isAdmin && (
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => { setEditTarget(role); setModalOpen(true); }}>
                            Edit
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(role)}>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <ul className="perm-list">
                    {role.permissions.length === 0 ? (
                      <li className="perm-item" style={{ color: "#aab4be" }}>No permissions assigned</li>
                    ) : role.permissions.map(p => (
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
        </>
      )}

      {modalOpen && (
        <CustomRoleModal
          role={editTarget ?? undefined}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
          onSaved={handleSaved}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          message={`Delete role "${deleteTarget.name}"? Users assigned this role will lose their permissions.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
