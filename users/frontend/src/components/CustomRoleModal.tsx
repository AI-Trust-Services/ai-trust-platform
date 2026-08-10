import { useState, useEffect } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { CustomRole, CustomRoleCreate } from "../types";

const PERMISSION_GROUPS: { label: string; permissions: string[] }[] = [
  { label: "AI Systems", permissions: ["systems:read", "systems:write"] },
  { label: "Assessments", permissions: ["assessments:read", "assessments:write", "assessments:approve"] },
  { label: "Evidence", permissions: ["evidence:read", "evidence:write", "evidence:approve"] },
  { label: "Alerts", permissions: ["alerts:read", "alerts:handle", "alerts:manage_rules"] },
  { label: "Monitoring", permissions: ["monitoring:read"] },
  { label: "User Management", permissions: ["iam:manage"] },
];

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
  role?: CustomRole;
  onClose: () => void;
  onSaved: (role: CustomRole) => void;
}

export function CustomRoleModal({ role, onClose, onSaved }: Props) {
  const showToast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<Set<string>>(
    new Set(role?.permissions ?? [])
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function togglePermission(p: string) {
    setPermissions(prev => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  function toggleGroup(groupPerms: string[]) {
    const allSelected = groupPerms.every(p => permissions.has(p));
    setPermissions(prev => {
      const next = new Set(prev);
      groupPerms.forEach(p => allSelected ? next.delete(p) : next.add(p));
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { showToast("Name is required.", true); return; }
    if (permissions.size === 0) { showToast("Select at least one permission.", true); return; }
    setSaving(true);
    try {
      let saved: CustomRole;
      if (role) {
        saved = await api.updateCustomRole(role.id, {
          description,
          permissions: Array.from(permissions),
        });
      } else {
        const body: CustomRoleCreate = {
          name: name.trim(),
          description,
          permissions: Array.from(permissions),
        };
        saved = await api.createCustomRole(body);
      }
      onSaved(saved);
      showToast(role ? "Role updated." : "Role created.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal custom-role-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{role ? "Edit Role" : "Create Custom Role"}</span>
          <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field">
              <label>Role name *</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={!!role}
                placeholder="e.g. data_reviewer"
              />
              {role && <div className="field-hint">Role names cannot be changed after creation.</div>}
            </div>
            <div className="field">
              <label>Description</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What is this role for?"
              />
            </div>
            <div className="field">
              <label>Permissions *</label>
              <div className="perm-groups">
                {PERMISSION_GROUPS.map(group => {
                  const allSelected = group.permissions.every(p => permissions.has(p));
                  const someSelected = group.permissions.some(p => permissions.has(p));
                  return (
                    <div key={group.label} className="perm-group">
                      <div
                        className="perm-group-header"
                        onClick={() => toggleGroup(group.permissions)}
                      >
                        <span className={`perm-group-check ${allSelected ? "checked" : someSelected ? "partial" : ""}`}>
                          {allSelected ? "▣" : someSelected ? "▪" : "□"}
                        </span>
                        <span className="perm-group-label">{group.label}</span>
                      </div>
                      {group.permissions.map(p => (
                        <label key={p} className="perm-checkbox-row">
                          <input
                            type="checkbox"
                            checked={permissions.has(p)}
                            onChange={() => togglePermission(p)}
                          />
                          <span>{PERMISSION_LABELS[p] ?? p}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : role ? "Save changes" : "Create role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
