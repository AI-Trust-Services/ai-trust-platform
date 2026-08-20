import { useState, useEffect, useCallback } from "react";
import { Plus, ShieldCheck, Cpu, Briefcase, ClipboardCheck, Eye, BarChart3, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";

const ROLE_DESCRIPTIONS: Record<string, string> = {
  platform_administrator: "Full access to all features and user management.",
  ai_engineer: "Register and manage AI systems, view monitoring and alerts.",
  business_owner: "Approve assessments and evidence, read-only access to systems.",
  ai_compliance_officer: "Manage compliance assessments, obligations, controls and evidence.",
  auditor: "Read-only access to systems, assessments, evidence and monitoring.",
  executive: "High-level read access to systems and monitoring dashboards.",
};

const ROLE_ICONS: Record<string, LucideIcon> = {
  platform_administrator: ShieldCheck,
  ai_engineer: Cpu,
  business_owner: Briefcase,
  ai_compliance_officer: ClipboardCheck,
  auditor: Eye,
  executive: BarChart3,
};

function PermissionBadges({ permissions }: { permissions: string[] }) {
  if (permissions.length === 0) {
    return <span className="text-sm text-muted-foreground">No permissions assigned</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {permissions.map((p) => (
        <Badge key={p} variant="secondary" className="rounded-md text-[11px] font-normal">
          {PERMISSION_LABELS[p] ?? p}
        </Badge>
      ))}
    </div>
  );
}

function RoleCard({
  name, description, permissions, isCustom, onEdit, onDelete, isAdmin,
}: {
  name: string;
  description?: string;
  permissions: string[];
  isCustom?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  isAdmin: boolean;
}) {
  const Icon: LucideIcon = ROLE_ICONS[name] ?? UserCog;
  const label = isCustom ? name : (ROLE_LABELS[name] ?? name);

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <div className="flex items-start gap-3 p-5 pb-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold leading-tight text-foreground">{label}</span>
            {isCustom && (
              <Badge variant="secondary" className="rounded-full text-[10px]">Custom</Badge>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>
          )}
        </div>
        {isCustom && isAdmin && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
              Delete
            </Button>
          </div>
        )}
      </div>
      <Separator />
      <div className="flex flex-col gap-3 p-5 pt-4">
        <PermissionBadges permissions={permissions} />
        <span className="text-[11px] text-muted-foreground">
          {permissions.length} permission{permissions.length !== 1 ? "s" : ""}
        </span>
      </div>
    </Card>
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
          <h2 className="text-xl font-semibold text-foreground">Roles &amp; Permissions</h2>
          <p className="mt-1 text-sm text-muted-foreground">Built-in roles and custom roles defined for this platform</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditTarget(null); setModalOpen(true); }}>
            <Plus className="size-4" /> Create Role
          </Button>
        )}
      </div>

      {loading && <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load roles: {error}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">Built-in Roles</span>
            <Badge variant="secondary" className="rounded-full">{builtins.length}</Badge>
          </div>
          <div className="mb-10 grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {builtins.map(role => (
              <RoleCard
                key={role.name}
                name={role.name}
                description={ROLE_DESCRIPTIONS[role.name]}
                permissions={role.permissions}
                isAdmin={isAdmin}
              />
            ))}
          </div>

          <Separator className="mb-8" />

          <div className="mb-3 flex items-center gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">Custom Roles</span>
            <Badge variant="secondary" className="rounded-full">{customRoles.length}</Badge>
          </div>
          {customRoles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-12 text-center">
              <p className="text-sm text-muted-foreground">No custom roles yet.</p>
              {isAdmin && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => { setEditTarget(null); setModalOpen(true); }}>
                  <Plus className="size-4" /> Create your first role
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
              {customRoles.map(role => (
                <RoleCard
                  key={role.id}
                  name={role.name}
                  description={role.description}
                  permissions={role.permissions}
                  isCustom
                  isAdmin={isAdmin}
                  onEdit={() => { setEditTarget(role); setModalOpen(true); }}
                  onDelete={() => setDeleteTarget(role)}
                />
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
