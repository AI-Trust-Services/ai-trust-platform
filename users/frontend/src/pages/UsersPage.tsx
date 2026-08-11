import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import { InviteModal } from "../components/InviteModal";
import { UserDetailPanel } from "../components/UserDetailPanel";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { RoleSummary, UserDetail, UserSummary } from "../types";
import { ROLE_LABELS } from "../constants";


const PAGE_SIZE = 10;

export default function UsersPage() {
  const showToast = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, p: number, status: string) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        limit: String(PAGE_SIZE),
        offset: String(p * PAGE_SIZE),
      };
      if (q) params.search = q;
      if (status) params.enabled = status;
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
    Promise.all([api.getRoles(), api.getCustomRoles()])
      .then(([builtins, custom]) => {
        const customAsSummary: RoleSummary[] = custom.map(r => ({ id: r.id, name: r.name, description: r.description }));
        setRoles([...builtins, ...customAsSummary]);
      })
      .catch(() => {});
  }, []);

  // Debounce search; reset to page 0
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(0);
      load(search, 0, statusFilter);
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps -- load is stable but listing it would trigger on every render

  useEffect(() => { load(search, page, statusFilter); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally re-runs only on page change; search/status changes reset page via the effect above

  // Close dropdown on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openMenuId]);

  async function openDetail(id: string) {
    setSelectedId(id);
    try {
      setSelectedUser(await api.getUser(id));
    } catch (err) {
      showToast(String(err), true);
      setSelectedId(null);
    }
  }

  function handleUpdated(u: UserDetail) {
    setSelectedUser(u);
    setUsers(prev => prev.map((x: UserSummary) => x.id === u.id ? (u as UserSummary) : x));
  }

  function handleDeleted(id: string) {
    setSelectedUser(null);
    setSelectedId(null);
    setUsers(prev => prev.filter((x: UserSummary) => x.id !== id));
    setTotal((t: number) => t - 1);
  }

  async function confirmDelete(user: UserSummary) {
    setDeleteTarget(null);
    setDeleting(true);
    try {
      await api.deleteUser(user.id);
      handleDeleted(user.id);
      showToast("User deleted.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setDeleting(false);
    }
  }

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
        <div className="kpi-card">
          <div className="kpi-label">Total Users</div>
          <div className="kpi-value">{total}</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by name, username or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="filter-select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as "" | "true" | "false")}
        >
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th style={{ width: 48 }}></th>
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
              <tr key={u.id} className="clickable-row" onClick={() => openDetail(u.id)}>
                <td>
                  <div style={{ fontWeight: 500 }}>{u.firstName} {u.lastName}</div>
                  <div style={{ fontSize: 12, color: "#556b82" }}>{u.email}</div>
                </td>
                <td style={{ color: "#556b82" }}>{u.username}</td>
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
                  <button
                    className="kebab-btn"
                    aria-label="Actions"
                    disabled={deleting}
                    onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === u.id ? null : u.id); }}
                  >
                    ⋯
                  </button>
                  {openMenuId === u.id && (
                    <div className="dropdown">
                      <button className="dropdown-item" onClick={() => { openDetail(u.id); setOpenMenuId(null); }}>
                        View details
                      </button>
                      <button
                        className="dropdown-item danger"
                        onClick={() => { setOpenMenuId(null); setDeleteTarget(u); }}
                      >
                        Delete
                      </button>
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
            load(search, page, statusFilter);
            openDetail(u.id);
          }}
        />
      )}

      {selectedId && selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          roles={roles}
          onClose={() => { setSelectedUser(null); setSelectedId(null); }}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          message={`Delete ${deleteTarget.username}? This cannot be undone.`}
          onConfirm={() => confirmDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
