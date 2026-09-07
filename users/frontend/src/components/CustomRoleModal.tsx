import { useState } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { CustomRole, CustomRoleCreate } from "../types";
import { PERMISSION_LABELS } from "../constants";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const PERMISSION_GROUPS: { label: string; permissions: string[] }[] = [
  { label: "AI Systems", permissions: ["systems:read", "systems:write"] },
  { label: "Assessments", permissions: ["assessments:read", "assessments:write", "assessments:approve"] },
  { label: "Evidence", permissions: ["evidence:read", "evidence:write", "evidence:approve"] },
  { label: "Alerts", permissions: ["alerts:read", "alerts:handle", "alerts:manage_rules"] },
  { label: "Monitoring", permissions: ["monitoring:read"] },
  { label: "User Management", permissions: ["iam:manage"] },
];

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{role ? "Edit Role" : "Create Custom Role"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role-name">Role name *</Label>
              <Input
                id="role-name"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={!!role}
                placeholder="e.g. data_reviewer"
              />
              {role && <div className="text-xs text-muted-foreground">Role names cannot be changed after creation.</div>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role-desc">Description</Label>
              <Input
                id="role-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What is this role for?"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Permissions *</Label>
              <div className="flex flex-col gap-3">
                {PERMISSION_GROUPS.map(group => {
                  const allSelected = group.permissions.every(p => permissions.has(p));
                  const someSelected = group.permissions.some(p => permissions.has(p));
                  return (
                    <div key={group.label} className="rounded-md border border-border p-3">
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={allSelected ? true : someSelected ? "indeterminate" : false}
                          onCheckedChange={() => toggleGroup(group.permissions)}
                        />
                        <span className="text-sm font-semibold text-foreground">{group.label}</span>
                      </label>
                      <div className="mt-2 flex flex-col gap-2 pl-6">
                        {group.permissions.map(p => (
                          <label key={p} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                            <Checkbox
                              checked={permissions.has(p)}
                              onCheckedChange={() => togglePermission(p)}
                            />
                            <span>{PERMISSION_LABELS[p] ?? p}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : role ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
