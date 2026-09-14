import { useState, useEffect, useCallback } from "react";
import { Shield, Users, ShieldCheck, Bot, Mail, Settings, RefreshCw } from "lucide-react";
import LuigiClient from "@luigi-project/client";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import type { AdminStats } from "@/types";
import { useToast } from "@/App";

function navigate(path: string) {
  LuigiClient.linkManager().navigate(`/home/${path}`);
}

function KpiTile({
  icon,
  value,
  label,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-border bg-card p-5 flex items-center gap-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-semibold leading-none">{value}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{label}</p>
      </div>
      <button
        onClick={onAction}
        className="text-sm text-[var(--brand)] hover:underline shrink-0"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function AdminCard({
  icon,
  title,
  description,
  path,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  path: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground flex-1">{description}</p>
      <button
        onClick={() => navigate(path)}
        className="text-sm text-[var(--brand)] hover:underline text-left"
      >
        Open →
      </button>
    </div>
  );
}

export default function AdminHomePage() {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getStats();
      setStats(data);
    } catch {
      showToast("Failed to load admin statistics", true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const mailValue = stats
    ? (stats.mail_configured ? "Configured" : "—")
    : "—";

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-purple-600 text-white">
            <Shield className="size-7" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Platform Administration</h1>
            <p className="text-sm text-muted-foreground">
              Manage users, roles, access, integrations, and platform settings to keep your AI Trust platform secure and running smoothly.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2 shrink-0">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* KPI tiles */}
      <div className="flex gap-4 mb-8 flex-wrap">
        <KpiTile
          icon={<Users className="size-5" />}
          value={loading ? "…" : (stats?.user_count ?? 0)}
          label="Users"
          actionLabel="View all"
          onAction={() => navigate("users")}
        />
        <KpiTile
          icon={<ShieldCheck className="size-5" />}
          value={loading ? "…" : (stats?.role_count ?? 0)}
          label="Roles"
          actionLabel="View all"
          onAction={() => navigate("users")}
        />
        <KpiTile
          icon={<Bot className="size-5" />}
          value={loading ? "…" : (stats?.ai_provider_count ?? 0)}
          label="AI Providers"
          actionLabel="Configure"
          onAction={() => navigate("admin-ai-providers")}
        />
        <KpiTile
          icon={<Mail className="size-5" />}
          value={loading ? "…" : mailValue}
          label="Mail service"
          actionLabel="Configure"
          onAction={() => navigate("mail-service")}
        />
      </div>

      {/* Section cards */}
      <h2 className="text-base font-semibold mb-4">Administration</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AdminCard
          icon={<Users className="size-4" />}
          title="Users & roles"
          description="Add, invite, and manage platform users. Review invitations and user status."
          path="users"
        />
        <AdminCard
          icon={<ShieldCheck className="size-4" />}
          title="Roles & permissions"
          description="Create and manage roles. Define permissions and access levels."
          path="users"
        />
        <AdminCard
          icon={<Bot className="size-4" />}
          title="AI providers"
          description="Configure and manage connections to AI providers used across the platform."
          path="admin-ai-providers"
        />
        <AdminCard
          icon={<Mail className="size-4" />}
          title="Mail service (SMTP)"
          description="Configure SMTP settings for system notifications and emails."
          path="mail-service"
        />
        <AdminCard
          icon={<Settings className="size-4" />}
          title="Settings"
          description="General platform configuration and preferences."
          path="admin-settings"
        />
      </div>
    </div>
  );
}
