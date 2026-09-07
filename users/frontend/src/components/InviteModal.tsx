import { useState } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { InviteUserRequest, RoleSummary, UserDetail } from "../types";
import { ROLE_LABELS } from "../constants";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Props {
  roles: RoleSummary[];
  onClose: () => void;
  onCreated: (u: UserDetail) => void;
}

const NO_ROLE = "__none__";

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
    return (e: React.ChangeEvent<HTMLInputElement>) =>
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Invite User</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="flex flex-col gap-4 p-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-firstName">First name *</Label>
                <Input id="inv-firstName" required value={form.firstName} onChange={set("firstName")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-lastName">Last name *</Label>
                <Input id="inv-lastName" required value={form.lastName} onChange={set("lastName")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-username">Username *</Label>
                <Input id="inv-username" required value={form.username} onChange={set("username")} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-email">Email *</Label>
                <Input id="inv-email" required type="email" value={form.email} onChange={set("email")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-jobTitle">Job title</Label>
                <Input id="inv-jobTitle" value={form.jobTitle} onChange={set("jobTitle")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-department">Department</Label>
                <Input id="inv-department" value={form.department} onChange={set("department")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-businessUnit">Business unit</Label>
                <Input id="inv-businessUnit" value={form.businessUnit} onChange={set("businessUnit")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-phone">Phone</Label>
                <Input id="inv-phone" value={form.phone} onChange={set("phone")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Role</Label>
                <Select
                  value={role || NO_ROLE}
                  onValueChange={v => setRole(v === NO_ROLE ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ROLE}>— none —</SelectItem>
                    {roles.map(r => (
                      <SelectItem key={r.id} value={r.name}>{ROLE_LABELS[r.name] ?? r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-password">Temporary password *</Label>
                <Input id="inv-password" required type="password" value={form.temporaryPassword} onChange={set("temporaryPassword")} autoComplete="new-password" />
              </div>
            </div>
          </div>
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
