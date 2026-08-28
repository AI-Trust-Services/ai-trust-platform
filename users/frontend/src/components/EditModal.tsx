import { useState } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type { UpdateUserRequest, UserDetail } from "../types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="flex flex-col gap-4 p-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-firstName">First name</Label>
                <Input id="edit-firstName" value={form.firstName ?? ""} onChange={set("firstName")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-lastName">Last name</Label>
                <Input id="edit-lastName" value={form.lastName ?? ""} onChange={set("lastName")} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" value={form.email ?? ""} onChange={set("email")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-jobTitle">Job title</Label>
                <Input id="edit-jobTitle" value={form.jobTitle ?? ""} onChange={set("jobTitle")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-department">Department</Label>
                <Input id="edit-department" value={form.department ?? ""} onChange={set("department")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-businessUnit">Business unit</Label>
                <Input id="edit-businessUnit" value={form.businessUnit ?? ""} onChange={set("businessUnit")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input id="edit-phone" value={form.phone ?? ""} onChange={set("phone")} />
              </div>
            </div>
          </div>
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
