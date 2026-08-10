import { useState } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { RoleSummary, UserDetail } from "../types";
import { EditModal } from "./EditModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ROLE_LABELS } from "../constants";

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

interface Props {
  user: UserDetail;
  roles: RoleSummary[];
  rolePermissions: Record<string, string[]>;
  onClose: () => void;
  onUpdated: (u: UserDetail) => void;
  onDeleted: (id: string) => void;
}

export function UserDetailPanel({ user, roles, rolePermissions, onClose, onUpdated, onDeleted }: Props) {
  const showToast = useToast();
  const [working, setWorking] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addRole, setAddRole] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const attr = (key: string) => user.attributes[key]?.[0] ?? "—";

  async function toggle() {
    setWorking(true);
    try {
      const updated = user.enabled
        ? await api.deactivateUser(user.id)
        : await api.activateUser(user.id);
      onUpdated(updated);
      showToast(updated.enabled ? "User activated." : "User deactivated.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setWorking(false);
    }
  }

  async function handleDelete() {
    setConfirmDelete(false);
    setWorking(true);
    try {
      await api.deleteUser(user.id);
      onDeleted(user.id);
      showToast("User deleted.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setWorking(false);
    }
  }

  async function handleAssignRole() {
    if (!addRole) return;
    setWorking(true);
    try {
      const updated = await api.assignRole(user.id, addRole);
      onUpdated(updated);
      setAddRole("");
      showToast("Role assigned.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setWorking(false);
    }
  }

  async function handleRemoveRole(roleName: string) {
    setWorking(true);
    try {
      const updated = await api.removeRole(user.id, roleName);
      onUpdated(updated);
      showToast("Role removed.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setWorking(false);
    }
  }

  const availableRoles = roles.filter(r => !user.roles.includes(r.name));

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden="true" />
      <div className="panel" role="dialog" aria-modal="true">
        <div className="panel-header">
          <div>
            <div className="panel-user-name">{user.firstName} {user.lastName}</div>
            <div className="panel-user-email">{user.email}</div>
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close panel">×</button>
        </div>
        <div className="panel-body">
          <div className="panel-section">
            <div className="panel-section-title">User Information</div>
            <div className="panel-row"><span className="panel-label">Username</span><span className="panel-value">{user.username}</span></div>
            <div className="panel-row"><span className="panel-label">Job title</span><span className="panel-value">{attr("jobTitle")}</span></div>
            <div className="panel-row"><span className="panel-label">Department</span><span className="panel-value">{attr("department")}</span></div>
            <div className="panel-row"><span className="panel-label">Business unit</span><span className="panel-value">{attr("businessUnit")}</span></div>
            <div className="panel-row"><span className="panel-label">Phone</span><span className="panel-value">{attr("phone")}</span></div>
          </div>
          <div className="panel-section">
            <div className="panel-section-title">Account Status</div>
            <div className="panel-row">
              <span className="panel-label">Status</span>
              <span className="panel-value">
                <span className={`badge ${user.enabled ? "badge-active" : "badge-inactive"}`}>
                  {user.enabled ? "Active" : "Inactive"}
                </span>
              </span>
            </div>
            <div className="panel-row">
              <span className="panel-label">Email verified</span>
              <span className="panel-value">{user.emailVerified ? "Yes" : "No"}</span>
            </div>
          </div>
          <div className="panel-section">
            <div className="panel-section-title">Roles</div>
            {user.roles.length === 0 && (
              <div className="panel-empty">No roles assigned.</div>
            )}
            {user.roles.map(r => (
              <div key={r} className="panel-role-row">
                <span className="badge badge-role">{ROLE_LABELS[r] ?? r}</span>
                <button className="btn btn-sm btn-danger" onClick={() => handleRemoveRole(r)} disabled={working}>
                  Remove
                </button>
              </div>
            ))}
            {availableRoles.length > 0 && (
              <div className="panel-role-add">
                <select value={addRole} onChange={e => setAddRole(e.target.value)}>
                  <option value="">Add role…</option>
                  {availableRoles.map(r => (
                    <option key={r.id} value={r.name}>{ROLE_LABELS[r.name] ?? r.name}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleAssignRole}
                  disabled={!addRole || working}
                >
                  Assign
                </button>
              </div>
            )}
          </div>
          <div className="panel-section">
            <div className="panel-section-title">Permissions</div>
            {user.roles.length === 0 ? (
              <div className="panel-empty">No permissions (no roles assigned).</div>
            ) : (
              user.roles.map(r => {
                const perms = rolePermissions[r] ?? [];
                return (
                  <div key={r} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1d2d3e", marginBottom: 6 }}>
                      {ROLE_LABELS[r] ?? r}
                    </div>
                    {perms.length === 0 ? (
                      <div className="panel-empty" style={{ paddingLeft: 0 }}>No permissions</div>
                    ) : (
                      <ul className="perm-list" style={{ margin: 0 }}>
                        {perms.map(p => (
                          <li key={p} className="perm-item">
                            <span className="perm-check">✓</span>
                            {PERMISSION_LABELS[p] ?? p}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="panel-footer">
          <button className="btn btn-secondary" onClick={() => setEditOpen(true)} disabled={working}>Edit</button>
          <button className="btn btn-secondary" onClick={toggle} disabled={working}>
            {user.enabled ? "Deactivate" : "Activate"}
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={working}>Delete</button>
        </div>
      </div>

      {editOpen && (
        <EditModal
          user={user}
          onClose={() => setEditOpen(false)}
          onSaved={u => { onUpdated(u); setEditOpen(false); }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          message={`Delete ${user.username}? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
