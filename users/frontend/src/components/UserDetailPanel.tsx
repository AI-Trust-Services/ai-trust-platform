import { useState } from "react";
import { Check } from "lucide-react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { RoleSummary, UserDetail } from "../types";
import { EditModal } from "./EditModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ROLE_LABELS, PERMISSION_LABELS } from "../constants";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  user: UserDetail;
  roles: RoleSummary[];
  rolePermissions: Record<string, string[]>;
  onClose: () => void;
  onUpdated: (u: UserDetail) => void;
  onDeleted: (id: string) => void;
}

const ADD_ROLE = "__add__";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
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
      <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{user.firstName} {user.lastName}</SheetTitle>
            <SheetDescription>{user.email}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="mb-6">
              <SectionTitle>User Information</SectionTitle>
              <Row label="Username">{user.username}</Row>
              <Row label="Job title">{attr("jobTitle")}</Row>
              <Row label="Department">{attr("department")}</Row>
              <Row label="Business unit">{attr("businessUnit")}</Row>
              <Row label="Phone">{attr("phone")}</Row>
            </div>

            <div className="mb-6">
              <SectionTitle>Account Status</SectionTitle>
              <Row label="Status">
                <span
                  className={cn(
                    "inline-block rounded-md px-2 py-0.5 text-xs font-medium",
                    user.enabled
                      ? "bg-[var(--success-bg)] text-[var(--success-fg)]"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {user.enabled ? "Active" : "Inactive"}
                </span>
              </Row>
              <Row label="Email verified">{user.emailVerified ? "Yes" : "No"}</Row>
            </div>

            <div className="mb-6">
              <SectionTitle>Roles</SectionTitle>
              {user.roles.length === 0 && (
                <div className="text-sm text-muted-foreground">No roles assigned.</div>
              )}
              <div className="flex flex-col gap-2">
                {user.roles.map(r => (
                  <div key={r} className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">{ROLE_LABELS[r] ?? r}</Badge>
                    <Button variant="destructive" size="sm" onClick={() => handleRemoveRole(r)} disabled={working}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              {availableRoles.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <Select
                    value={addRole || ADD_ROLE}
                    onValueChange={v => setAddRole(v === ADD_ROLE ? "" : v)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Add role…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRoles.map(r => (
                        <SelectItem key={r.id} value={r.name}>{ROLE_LABELS[r.name] ?? r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={handleAssignRole} disabled={!addRole || working}>
                    Assign
                  </Button>
                </div>
              )}
            </div>

            <div>
              <SectionTitle>Permissions</SectionTitle>
              {user.roles.length === 0 ? (
                <div className="text-sm text-muted-foreground">No permissions (no roles assigned).</div>
              ) : (
                user.roles.map(r => {
                  const perms = rolePermissions[r] ?? [];
                  return (
                    <div key={r} className="mb-3">
                      <div className="mb-1.5 text-[13px] font-semibold text-foreground">
                        {ROLE_LABELS[r] ?? r}
                      </div>
                      {perms.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No permissions</div>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {perms.map(p => (
                            <li key={p} className="flex items-center gap-2 text-sm text-foreground">
                              <Check className="size-3.5 shrink-0 text-[var(--success-fg)]" />
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

          <SheetFooter className="flex-row justify-end">
            <Button variant="outline" onClick={() => setEditOpen(true)} disabled={working}>Edit</Button>
            <Button variant="outline" onClick={toggle} disabled={working}>
              {user.enabled ? "Deactivate" : "Activate"}
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)} disabled={working}>Delete</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
