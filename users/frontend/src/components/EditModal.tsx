import { useState } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { UpdateUserRequest, UserDetail } from "../types";

interface Props {
  user: UserDetail;
  onClose: () => void;
  onSaved: (u: UserDetail) => void;
}

export function EditModal({ user, onClose, onSaved }: Props) {
  const showToast = useToast();
  const [saving, setSaving] = useState(false);
  const attr = (key: string) => user.attributes[key]?.[0] ?? "";
  const [form, setForm] = useState<UpdateUserRequest>({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    jobTitle: attr("jobTitle"),
    department: attr("department"),
    businessUnit: attr("businessUnit"),
    phone: attr("phone"),
  });

  function set(key: keyof UpdateUserRequest) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateUser(user.id, form);
      onSaved(updated);
      showToast("User updated.");
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
          <span className="modal-title">Edit User</span>
          <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field-row">
              <div className="field">
                <label>First name</label>
                <input value={form.firstName ?? ""} onChange={set("firstName")} />
              </div>
              <div className="field">
                <label>Last name</label>
                <input value={form.lastName ?? ""} onChange={set("lastName")} />
              </div>
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={form.email ?? ""} onChange={set("email")} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Job title</label>
                <input value={form.jobTitle ?? ""} onChange={set("jobTitle")} />
              </div>
              <div className="field">
                <label>Department</label>
                <input value={form.department ?? ""} onChange={set("department")} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Business unit</label>
                <input value={form.businessUnit ?? ""} onChange={set("businessUnit")} />
              </div>
              <div className="field">
                <label>Phone</label>
                <input value={form.phone ?? ""} onChange={set("phone")} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
