/**
 * ActivityTab — Displays system activity timeline from workflow history.
 */

import { useState, useEffect, useCallback } from "react";
import { Activity, RotateCw, User, CheckCircle2, Send, XCircle, FileText, Clock } from "lucide-react";
import { api } from "../api/client";
import type { WorkflowStep, AISystem } from "../types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ActivityTabProps {
  systemId: string;
  system: AISystem;
}

// Map workflow step types to display info
const STEP_CONFIG: Record<string, { icon: typeof Activity; label: string; color: string }> = {
  created: { icon: FileText, label: "System Created", color: "text-blue-600" },
  submitted: { icon: Send, label: "Submitted for Review", color: "text-purple-600" },
  approved: { icon: CheckCircle2, label: "Approved", color: "text-green-600" },
  rejected: { icon: XCircle, label: "Returned for Changes", color: "text-red-600" },
  updated: { icon: Activity, label: "System Updated", color: "text-gray-600" },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export default function ActivityTab({ systemId, system }: ActivityTabProps) {
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const steps = await api.getWorkflow(systemId);
      setWorkflow(steps);
    } catch (e) {
      console.error("Failed to load workflow:", e);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RotateCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Build activity items from workflow + system timestamps
  const activities: Array<{
    id: string;
    type: string;
    actor: string;
    assignee?: string | null;
    note?: string | null;
    timestamp: string;
  }> = [];

  // Add workflow steps
  workflow.forEach((step) => {
    activities.push({
      id: step.id,
      type: step.step,
      actor: step.actor_username,
      assignee: step.assignee_username,
      note: step.note,
      timestamp: step.created_at,
    });
  });

  // Add system creation if no workflow
  if (activities.length === 0) {
    activities.push({
      id: "created",
      type: "created",
      actor: system.owner_username || "Unknown",
      timestamp: system.created_at,
    });
  }

  // Sort by timestamp descending (newest first)
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Activity</h2>
          <p className="text-sm text-muted-foreground">Timeline of changes and workflow events</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RotateCw className="mr-2 size-4" /> Refresh
        </Button>
      </div>

      {/* Timeline */}
      <Card className="p-6">
        {activities.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Activity className="mx-auto mb-4 size-12 text-muted-foreground/50" />
            <p>No activity recorded yet.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-5 top-0 h-full w-0.5 bg-border" />

            {/* Activity items */}
            <div className="space-y-6">
              {activities.map((activity, index) => {
                const config = STEP_CONFIG[activity.type] || {
                  icon: Activity,
                  label: activity.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                  color: "text-gray-600",
                };
                const Icon = config.icon;

                return (
                  <div key={activity.id} className="relative flex gap-4">
                    {/* Icon */}
                    <div
                      className={cn(
                        "relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-card ring-4 ring-card",
                        index === 0 ? "ring-primary/20" : ""
                      )}
                    >
                      <div className={cn("flex size-8 items-center justify-center rounded-full bg-muted", index === 0 && "bg-primary/10")}>
                        <Icon className={cn("size-4", config.color)} />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{config.label}</span>
                          {index === 0 && (
                            <Badge variant="secondary" className="text-xs">Latest</Badge>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground" title={`${formatDate(activity.timestamp)} ${formatTime(activity.timestamp)}`}>
                          {formatRelative(activity.timestamp)}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="size-3" />
                        <span>{activity.actor}</span>
                        {activity.assignee && (
                          <>
                            <span>→</span>
                            <span>{activity.assignee}</span>
                          </>
                        )}
                      </div>

                      {activity.note && (
                        <p className="mt-2 rounded-md bg-muted/50 p-3 text-sm">
                          {activity.note}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* System timestamps */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-medium">System Timestamps</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Created:</span>
            <span>{formatDate(system.created_at)} {formatTime(system.created_at)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Last updated:</span>
            <span>{formatDate(system.updated_at)} {formatTime(system.updated_at)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
