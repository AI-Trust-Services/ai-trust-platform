import { useState } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { InviteUserRequest, RoleSummary, UserDetail } from "../types";

const ROLE_LABELS: Record<string, string> = {
  platform_administrator: "Platform Administrator",
  ai_engineer: "AI Engineer",
  business_owner: "Business Owner",
  ai_compliance_officer: "AI Compliance Officer",
  auditor: "Auditor",
  executive: "Executive",
};

interface Props {
  roles: RoleSummary[];
  onClose: () => void;
  onCreated: (u: UserDetail) => void;
}

export function InviteModal({ roles, onClose, onCreated }: Props) {
  const showToast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<InviteUserRequest>({
    username: "", email: "", firstName: "", lastName: "",
    department: "", businessUnit: "", jobTitle: "", phone: "",
    preferredLanguage: "", temporaryPassword: "",
  });
  const [role, setRole] = useState("");

  function set(key: keyof InviteUserRequest) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const user = await api.inviteUser(form);
      if (role) await api.assignRole(user.id, role);
      onCreated(user);
      showToast("User created.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Invite User</span>
          <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field-row">
              <div className="field">
                <label>First name *</label>
                <input required value={form.firstName} onChange={set("firstName")} />
              </div>
              <div className="field">
                <label>Last name *</label>
                <input required value={form.lastName} onChange={set("lastName")} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Username *</label>
                <input required value={form.username} onChange={set("username")} autoComplete="off" />
              </div>
              <div className="field">
                <label>Email *</label>
                <input required type="email" value={form.email} onChange={set("email")} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Job title</label>
                <input value={form.jobTitle} onChange={set("jobTitle")} />
              </div>
              <div className="field">
                <label>Department</label>
                <input value={form.department} onChange={set("department")} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Business unit</label>
                <input value={form.businessUnit} onChange={set("businessUnit")} />
              </div>
              <div className="field">
                <label>Phone</label>
                <input value={form.phone} onChange={set("phone")} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Role</label>
                <select value={role} onChange={e => setRole(e.target.value)}>
                  <option value="">— none —</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.name}>{ROLE_LABELS[r.name] ?? r.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Temporary password *</label>
                <input required type="password" value={form.temporaryPassword} onChange={set("temporaryPassword")} autoComplete="new-password" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
