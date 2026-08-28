import { useState, useEffect } from "react";
import LuigiClient from "@luigi-project/client";
import {
  Users,
  Shield,
  Bot,
  Mail,
  Settings,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  XCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { api, DashboardResponse, AdminActivity } from "../api/client";
import { useToast } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// Helper to navigate via Luigi Client API
function navigateToLuigi(path: string) {
  LuigiClient.linkManager().navigate(path);
}

// KPI Card component
function KPICard({
  icon: Icon,
  value,
  label,
  action,
  actionPath,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  action?: string;
  actionPath?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-6" />
        </div>
        <div className="flex-1">
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
        {action && actionPath && (
          <button
            onClick={() => navigateToLuigi(actionPath)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {action}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// Admin section card
function AdminCard({
  icon: Icon,
  title,
  description,
  path,
  iconBg = "bg-primary/10 text-primary",
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  path: string;
  iconBg?: string;
}) {
  return (
    <button onClick={() => navigateToLuigi(path)} className="text-left w-full">
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="flex items-start gap-4 p-6">
          <div className={cn("flex size-12 items-center justify-center rounded-xl", iconBg)}>
            <Icon className="size-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <div className="mt-3 flex items-center text-sm font-medium text-primary">
              Open <ArrowRight className="ml-1 size-4" />
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

// Status indicator
function StatusBadge({ status, label }: { status: string; label: string }) {
  const config: Record<string, { icon: React.ElementType; className: string }> = {
    healthy: { icon: CheckCircle, className: "bg-green-100 text-green-700 border-green-200" },
    warning: { icon: AlertCircle, className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    error: { icon: XCircle, className: "bg-red-100 text-red-700 border-red-200" },
    not_configured: { icon: AlertCircle, className: "bg-gray-100 text-gray-600 border-gray-200" },
  };

  const { icon: StatusIcon, className } = config[status] || config.not_configured;

  return (
    <Badge variant="outline" className={cn("gap-1.5", className)}>
      <StatusIcon className="size-3.5" />
      {label}
    </Badge>
  );
}

// Activity item
function ActivityItem({ activity }: { activity: AdminActivity }) {
  const date = new Date(activity.timestamp);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Settings className="size-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{activity.description}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {activity.actor && <span>{activity.actor} · </span>}
          {formattedDate}, {formattedTime}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [activities, setActivities] = useState<AdminActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const showToast = useToast();

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const [dashboardRes, activityRes] = await Promise.all([
        api.dashboard.get(),
        api.dashboard.getActivity(),
      ]);
      setData(dashboardRes);
      setActivities(activityRes.activities);
    } catch (err) {
      showToast("Failed to load dashboard", true);
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const kpis = data?.kpis;
  const configStatuses = data?.configuration_status || [];

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
            <Shield className="size-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Platform Administration</h1>
            <p className="text-muted-foreground">
              Manage users, roles, access, integrations, and platform settings
              to keep your AI Trust platform secure and running smoothly.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadData(true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("size-4 mr-2", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          icon={Users}
          value={kpis?.user_count ?? 0}
          label="Users"
          action="View all"
          actionPath="/home/users"
        />
        <KPICard
          icon={Shield}
          value={kpis?.role_count ?? 0}
          label="Roles"
          action="View all"
          actionPath="/home/users"
        />
        <KPICard
          icon={Bot}
          value={kpis?.ai_provider_count ?? 0}
          label="AI Providers"
          action="Configure"
          actionPath="/home/admin-ai-providers"
        />
        <KPICard
          icon={Mail}
          value={kpis?.mail_status === "connected" ? "Connected" : "—"}
          label="Mail service"
          action="Configure"
          actionPath="/home/admin-mail-service"
        />
      </div>

      {/* Administration Cards */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Administration</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AdminCard
            icon={Users}
            title="Users & roles"
            description="Add, invite, and manage platform users. Review invitations and user status."
            path="/home/users"
          />
          <AdminCard
            icon={Shield}
            title="Roles & permissions"
            description="Create and manage roles. Define permissions and access levels."
            path="/home/users"
            iconBg="bg-purple-100 text-purple-600"
          />
          <AdminCard
            icon={Bot}
            title="AI providers"
            description="Configure and manage connections to AI providers used across the platform."
            path="/home/admin-ai-providers"
            iconBg="bg-blue-100 text-blue-600"
          />
          <AdminCard
            icon={Mail}
            title="Mail service (SMTP)"
            description="Configure SMTP settings for system notifications and emails."
            path="/home/admin-mail-service"
            iconBg="bg-green-100 text-green-600"
          />
          <AdminCard
            icon={Settings}
            title="Settings"
            description="General platform configuration and preferences."
            path="/home/admin-settings"
            iconBg="bg-orange-100 text-orange-600"
          />
        </div>
      </div>

      {/* Bottom section: Config status + Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Configuration Status */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {configStatuses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No configuration data available.</p>
            ) : (
              configStatuses.map((status) => (
                <div key={status.key} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium text-sm">{status.label}</div>
                    <div className="text-xs text-muted-foreground">{status.message}</div>
                  </div>
                  <StatusBadge status={status.status} label={status.status === "healthy" ? "Healthy" : status.status} />
                </div>
              ))
            )}
            <Separator />
            <button
              onClick={() => navigateToLuigi("/home/admin-settings")}
              className="flex items-center text-sm font-medium text-primary hover:underline"
            >
              View all settings <ArrowRight className="ml-1 size-4" />
            </button>
          </CardContent>
        </Card>

        {/* Recent Admin Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent admin activity</CardTitle>
            <CardDescription>Latest configuration changes</CardDescription>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No recent activity.</p>
            ) : (
              <div className="divide-y">
                {activities.slice(0, 5).map((activity) => (
                  <ActivityItem key={activity.id} activity={activity} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
