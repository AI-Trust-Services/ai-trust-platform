import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { InviteUserRequest, RoleSummary, UpdateUserRequest, UserDetail, UserSummary } from "../types";

const ROLE_LABELS: Record<string, string> = {
  platform_administrator: "Platform Administrator",
  ai_engineer: "AI Engineer",
  business_owner: "Business Owner",
  ai_compliance_officer: "AI Compliance Officer",
  auditor: "Auditor",
  executive: "Executive",
};

const PAGE_SIZE = 10;

// ── Invite modal ─────────────────────────────────────────────────────────────

function InviteModal({ roles, onClose, onCreated }: {
  roles: RoleSummary[];
  onClose: () => void;
  onCreated: (u: UserDetail) => void;
}) {
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
          <button className="panel-close" onClick={onClose}>×</button>
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
                <input required value={form.username} onChange={set("username")} />
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
                <input required type="password" value={form.temporaryPassword} onChange={set("temporaryPassword")} />
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

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({ user, onClose, onSaved }: {
  user: UserDetail;
  onClose: () => void;
  onSaved: (u: UserDetail) => void;
}) {
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
          <button className="panel-close" onClick={onClose}>×</button>
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

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ user, roles, onClose, onUpdated, onDeleted }: {
  user: UserDetail;
  roles: RoleSummary[];
  onClose: () => void;
  onUpdated: (u: UserDetail) => void;
  onDeleted: (id: string) => void;
}) {
  const showToast = useToast();
  const [working, setWorking] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addRole, setAddRole] = useState("");
  const attr = (key: string) => user.attributes[key]?.[0] ?? "—";

  async function toggle() {
    setWorking(true);
    try {
      const updated = user.enabled ? await api.deactivateUser(user.id) : await api.activateUser(user.id);
      onUpdated(updated);
      showToast(updated.enabled ? "User activated." : "User deactivated.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${user.username}? This cannot be undone.`)) return;
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
      <div className="panel-overlay" onClick={onClose} />
      <div className="panel">
        <div className="panel-header">
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{user.firstName} {user.lastName}</div>
            <div style={{ fontSize: 12, color: "#556b82", marginTop: 2 }}>{user.email}</div>
          </div>
          <button className="panel-close" onClick={onClose}>×</button>
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
            <div className="panel-row"><span className="panel-label">Email verified</span><span className="panel-value">{user.emailVerified ? "Yes" : "No"}</span></div>
          </div>
          <div className="panel-section">
            <div className="panel-section-title">Roles</div>
            {user.roles.length === 0 && <div style={{ color: "#556b82", fontSize: 13 }}>No roles assigned.</div>}
            {user.roles.map(r => (
              <div key={r} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="badge badge-role">{ROLE_LABELS[r] ?? r}</span>
                <button className="btn btn-sm btn-danger" onClick={() => handleRemoveRole(r)} disabled={working}>Remove</button>
              </div>
            ))}
            {availableRoles.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <select value={addRole} onChange={e => setAddRole(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Add role…</option>
                  {availableRoles.map(r => (
                    <option key={r.id} value={r.name}>{ROLE_LABELS[r.name] ?? r.name}</option>
                  ))}
                </select>
                <button className="btn btn-primary btn-sm" onClick={handleAssignRole} disabled={!addRole || working}>
                  Assign
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="panel-footer">
          <button className="btn btn-secondary" onClick={() => setEditOpen(true)} disabled={working}>Edit</button>
          <button className="btn btn-secondary" onClick={toggle} disabled={working}>
            {user.enabled ? "Deactivate" : "Activate"}
          </button>
          <button className="btn btn-danger" onClick={remove} disabled={working}>Delete</button>
        </div>
      </div>
      {editOpen && (
        <EditModal
          user={user}
          onClose={() => setEditOpen(false)}
          onSaved={u => { onUpdated(u); setEditOpen(false); }}
        />
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UsersPage(): JSX.Element {
  const showToast = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        limit: String(PAGE_SIZE),
        offset: String(p * PAGE_SIZE),
      };
      if (q) params.search = q;
      const res = await api.getUsers(params);
      setUsers(res.users);
      setTotal(res.total);
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    api.getRoles().then(setRoles).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(0); load(search, 0); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, load]);

  useEffect(() => { load(search, page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(id: string) {
    setSelectedId(id);
    try {
      const u = await api.getUser(id);
      setSelectedUser(u);
    } catch (err) {
      showToast(String(err), true);
      setSelectedId(null);
    }
  }

  function handleUpdated(u: UserDetail) {
    setSelectedUser(u);
    setUsers(prev => prev.map(x => x.id === u.id ? u : x));
  }

  function handleDeleted(id: string) {
    setSelectedUser(null);
    setSelectedId(null);
    setUsers(prev => prev.filter(x => x.id !== id));
    setTotal(t => t - 1);
  }

  const active = users.filter(u => u.enabled).length;
  const inactive = users.filter(u => !u.enabled).length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Users &amp; Roles</div>
          <div className="page-subtitle">Manage platform users and role assignments</div>
        </div>
        <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>+ Invite User</button>
      </div>

      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-label">Total Users</div><div className="kpi-value">{total}</div></div>
        <div className="kpi-card"><div className="kpi-label">Active</div><div className="kpi-value">{active}</div></div>
        <div className="kpi-card"><div className="kpi-label">Inactive</div><div className="kpi-value">{inactive}</div></div>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role(s)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="empty">Loading…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} className="empty">No users found.</td></tr>
            )}
            {!loading && users.map(u => (
              <tr key={u.id} style={{ cursor: "pointer" }} onClick={() => openDetail(u.id)}>
                <td style={{ fontWeight: 500 }}>{u.firstName} {u.lastName}</td>
                <td style={{ color: "#556b82" }}>{u.email}</td>
                <td>
                  {u.roles.length === 0
                    ? <span style={{ color: "#aab4be" }}>—</span>
                    : u.roles.map(r => (
                      <span key={r} className="badge badge-role">{ROLE_LABELS[r] ?? r}</span>
                    ))
                  }
                </td>
                <td>
                  <span className={`badge ${u.enabled ? "badge-active" : "badge-inactive"}`}>
                    {u.enabled ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="action-cell" onClick={e => e.stopPropagation()}>
                  <button className="kebab-btn" onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}>⋯</button>
                  {openMenuId === u.id && (
                    <div className="dropdown">
                      <button className="dropdown-item" onClick={() => { openDetail(u.id); setOpenMenuId(null); }}>View details</button>
                      <button className="dropdown-item danger" onClick={async () => {
                        setOpenMenuId(null);
                        if (!confirm(`Delete ${u.username}?`)) return;
                        try {
                          await api.deleteUser(u.id);
                          handleDeleted(u.id);
                          showToast("User deleted.");
                        } catch (err) { showToast(String(err), true); }
                      }}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
          <span className="pagination-info">Page {page + 1} of {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
        </div>
      )}

      {inviteOpen && (
        <InviteModal
          roles={roles}
          onClose={() => setInviteOpen(false)}
          onCreated={u => {
            setInviteOpen(false);
            load(search, page);
            openDetail(u.id);
          }}
        />
      )}

      {selectedId && selectedUser && (
        <DetailPanel
          user={selectedUser}
          roles={roles}
          onClose={() => { setSelectedUser(null); setSelectedId(null); }}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
