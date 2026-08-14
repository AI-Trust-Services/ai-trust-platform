import { useState, useEffect, useCallback } from "react";
import { Check, Plus } from "lucide-react";
import { useToast } from "../App";
import { api } from "../api/client";
import { CustomRoleModal } from "../components/CustomRoleModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { CustomRole, RoleInfo } from "../types";
import { usePermissions } from "../hooks/usePermissions";
import { ROLE_LABELS, PERMISSION_LABELS } from "../constants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ROLE_DESCRIPTIONS: Record<string, string> = {
  platform_administrator: "Full access to all features and user management.",
  ai_engineer: "Register and manage AI systems, view monitoring and alerts.",
  business_owner: "Approve assessments and evidence, read-only access to systems.",
  ai_compliance_officer: "Manage compliance assessments, obligations, controls and evidence.",
  auditor: "Read-only access to systems, assessments, evidence and monitoring.",
  executive: "High-level read access to systems and monitoring dashboards.",
};

function PermList({ permissions }: { permissions: string[] }) {
  if (permissions.length === 0) {
    return <div className="text-sm text-muted-foreground">No permissions assigned</div>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {permissions.map((p) => (
        <li key={p} className="flex items-center gap-2 text-sm text-foreground">
          <Check className="size-3.5 shrink-0 text-[var(--success-fg)]" />
          {PERMISSION_LABELS[p] ?? p}
        </li>
      ))}
    </ul>
  );
}

export default function RolesPage() {
  const showToast = useToast();
  const { can } = usePermissions();
  const isAdmin = can("iam:manage");

  const [builtins, setBuiltins] = useState<RoleInfo[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomRole | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([api.getRoleDetails(), api.getCustomRoles()]);
      setBuiltins(b);
      setCustomRoles(c);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteCustomRole(deleteTarget.id);
      setCustomRoles(prev => prev.filter(r => r.id !== deleteTarget.id));
      showToast("Role deleted.");
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setDeleteTarget(null);
    }
  }

  function handleSaved(role: CustomRole) {
    setCustomRoles(prev => {
      const idx = prev.findIndex(r => r.id === role.id);
      return idx >= 0 ? prev.map(r => r.id === role.id ? role : r) : [...prev, role];
    });
    setModalOpen(false);
    setEditTarget(null);
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Built-in roles and custom roles for this platform</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditTarget(null); setModalOpen(true); }}>
            <Plus className="size-4" /> Create Role
          </Button>
        )}
      </div>

      {loading && <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load roles: {error}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && (
        <>
          <div className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Built-in Roles
          </div>
          <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {builtins.map(role => (
              <Card key={role.name} className="flex flex-col gap-3 p-5">
                <div>
                  <div className="text-[15px] font-semibold text-foreground">{ROLE_LABELS[role.name] ?? role.name}</div>
                  {ROLE_DESCRIPTIONS[role.name] && (
                    <div className="mt-1 text-[13px] text-muted-foreground">{ROLE_DESCRIPTIONS[role.name]}</div>
                  )}
                </div>
                <PermList permissions={role.permissions} />
              </Card>
            ))}
          </div>

          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Custom Roles
            <Badge variant="secondary">{customRoles.length}</Badge>
          </div>
          {customRoles.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No custom roles yet.{isAdmin && " Click \"Create Role\" to add one."}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
              {customRoles.map(role => (
                <Card key={role.id} className="flex flex-col gap-3 border-l-2 border-l-primary p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[15px] font-semibold text-foreground">{role.name}</div>
                      {role.description && (
                        <div className="mt-1 text-[13px] text-muted-foreground">{role.description}</div>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => { setEditTarget(role); setModalOpen(true); }}>
                          Edit
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(role)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                  <PermList permissions={role.permissions} />
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <CustomRoleModal
          role={editTarget ?? undefined}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
          onSaved={handleSaved}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          message={`Delete role "${deleteTarget.name}"? Users assigned this role will lose their permissions.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
