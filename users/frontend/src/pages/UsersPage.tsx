import { useState, useEffect, useCallback } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { useToast } from "../App";
import { api } from "../api/client";
import { InviteModal } from "../components/InviteModal";
import { UserDetailPanel } from "../components/UserDetailPanel";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { RoleSummary, UserDetail, UserSummary } from "../types";
import { ROLE_LABELS } from "../constants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";


const PAGE_SIZE = 10;

export default function UsersPage() {
  const showToast = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    Promise.all([api.getRoles(), api.getCustomRoles(), api.getRoleDetails()])
      .then(([builtins, custom, roleDetails]) => {
        const customAsSummary: RoleSummary[] = custom.map(r => ({ id: r.id, name: r.name, description: r.description }));
        setRoles([...builtins, ...customAsSummary]);
        const map: Record<string, string[]> = {};
        for (const r of roleDetails) map[r.name] = r.permissions;
        for (const r of custom) map[r.name] = r.permissions;
        setRolePermissions(map);
      })
      .catch(() => {});
  }, []);

  // Debounce search; immediate for page/status changes
  useEffect(() => {
    const delay = search ? 300 : 0;
    const timer = setTimeout(() => load(search, page, statusFilter), delay);
    return () => clearTimeout(timer);
  }, [search, page, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps -- load is stable

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
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Manage platform users and role assignments
            {total > 0 && <span className="ml-1 text-foreground font-medium">· {total} total</span>}
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="size-4" /> Invite User
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search by name, username or email…"
          value={search}
          onChange={e => { setPage(0); setSearch(e.target.value); }}
        />
        <Select
          value={statusFilter || "all"}
          onValueChange={v => { setPage(0); setStatusFilter(v === "all" ? "" : (v as "true" | "false")); }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && users.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            )}
            {!loading && users.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No users found.</TableCell>
              </TableRow>
            )}
            {users.map((u: UserSummary) => {
              const initials = u.firstName && u.lastName
                ? (u.firstName[0] + u.lastName[0]).toUpperCase()
                : (u.username || "?").slice(0, 2).toUpperCase();
              return (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => openDetail(u.id)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                        {initials}
                      </span>
                      <div>
                        <div className="font-medium text-foreground">{u.firstName} {u.lastName}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.username}</TableCell>
                  <TableCell>
                    {u.roles.length === 0
                      ? <span className="text-muted-foreground">—</span>
                      : (
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map(r => (
                            <Badge key={r} variant="secondary">{ROLE_LABELS[r] ?? r}</Badge>
                          ))}
                        </div>
                      )
                    }
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-block rounded-md px-2 py-0.5 text-xs font-medium",
                        u.enabled
                          ? "bg-[var(--success-bg)] text-[var(--success-fg)]"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {u.enabled ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Actions" disabled={deleting}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openDetail(u.id)}>
                          View details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteTarget(u)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 && (
        <Pagination className="mt-4 justify-between">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                aria-disabled={page === 0}
                className={cn(page === 0 && "pointer-events-none opacity-50")}
                onClick={() => { if (page > 0) setPage(p => p - 1); }}
              />
            </PaginationItem>
          </PaginationContent>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <PaginationContent>
            <PaginationItem>
              <PaginationNext
                aria-disabled={page >= totalPages - 1}
                className={cn(page >= totalPages - 1 && "pointer-events-none opacity-50")}
                onClick={() => { if (page < totalPages - 1) setPage(p => p + 1); }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
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
          rolePermissions={rolePermissions}
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
