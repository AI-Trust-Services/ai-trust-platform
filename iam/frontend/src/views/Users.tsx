import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { UserRole, RoleInfo } from "../types";

function displayName(u: UserRole): string {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return full || u.username;
}

export default function Users() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([api.getUsers(), api.getRoles()]);
      setUsers(u);
      setRoles(r);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function changeRole(username: string, role: string) {
    setSavingUser(username);
    try {
      if (role === "") {
        await api.removeRole(username);
        toast(`Removed role from ${username}`);
      } else {
        await api.assignRole(username, role);
        toast(`Assigned ${role} to ${username}`);
      }
      setUsers((prev) =>
        prev.map((u) => (u.username === username ? { ...u, role: role || null } : u))
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSavingUser(null);
    }
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      displayName(u).toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="content">
      <div style={{ marginBottom: 16 }}>
        <input
          className="search-input"
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Status</th>
              <th style={{ width: 260 }}>Role</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="empty-row"><td colSpan={4}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr className="empty-row"><td colSpan={4}>No users found.</td></tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.username}>
                  <td>
                    <div className="user-name">{displayName(u)}</div>
                    <div className="user-sub">{u.username}</div>
                  </td>
                  <td>{u.email || "—"}</td>
                  <td>
                    {u.enabled ? (
                      <span className="badge badge-role">Enabled</span>
                    ) : (
                      <span className="badge badge-none">Disabled</span>
                    )}
                  </td>
                  <td>
                    <div className="role-picker">
                      <select
                        className="filter-select"
                        value={u.role ?? ""}
                        disabled={savingUser === u.username}
                        onChange={(e) => changeRole(u.username, e.target.value)}
                      >
                        <option value="">— No role —</option>
                        {roles.map((r) => (
                          <option key={r.name} value={r.name}>
                            {r.name.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      {savingUser === u.username && (
                        <span className="spinner" style={{ width: 14, height: 14 }} />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
