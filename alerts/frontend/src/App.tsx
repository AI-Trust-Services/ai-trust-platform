import React, { useState, useEffect, useCallback } from "react";
import { BellRing, Loader2, RefreshCw } from "lucide-react";
import { api, HEALTH_URL, ALERTS_URL } from "./api/client";
import { useLuigiInit, navigateTo } from "./hooks/useLuigi";
import { usePermissions } from "./hooks/usePermissions";
import { ToastProvider } from "./components/Toast";
import { NoAccess } from "./components/NoAccess";
import { ActiveAlerts } from "./views/ActiveAlerts";
import { AlertHistory } from "./views/AlertHistory";
import { AlertRules } from "./views/AlertRules";
import type { AlertEvent, AlertRule } from "./types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Tab = "active" | "history" | "rules";

export default function App() {
  useLuigiInit(() => {});

  const { can, loading: permsLoading } = usePermissions();
  const mayViewAlerts =
    can("alerts:read") || can("alerts:handle") || can("alerts:manage_rules");

  const [tab, setTab]               = useState<Tab>("active");
  const [backendOk, setBackendOk]   = useState<boolean | null>(null);
  const [activeAlerts, setActive]   = useState<AlertEvent[]>([]);
  const [history, setHistory]       = useState<AlertEvent[]>([]);
  const [rules, setRules]           = useState<AlertRule[]>([]);
  const [alertCount, setCount]      = useState(0);

  // ── Health polling ──────────────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const res = await fetch(HEALTH_URL);
        setBackendOk(res.ok);
        if (res.ok) loadAll();
      } catch {
        setBackendOk(false);
      }
      timer = setTimeout(check, 10000);
    }
    check();
    return () => clearTimeout(timer);
  }, []);

  // ── Auto-refresh active tab ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (tab === "active") loadActive();
    }, 30000);
    return () => clearInterval(id);
  }, [tab]);

  // ── Data loading ─────────────────────────────────────────────────────────────
  const loadActive = useCallback(async () => {
    try {
      const [data, countData] = await Promise.all([api.getActiveAlerts(), api.getAlertCount()]);
      setActive(data);
      setCount(countData.count);
    } catch {}
  }, []);

  const loadHistory = useCallback(async () => {
    try { setHistory(await api.getAlertHistory()); } catch {}
  }, []);

  const loadRules = useCallback(async () => {
    try { setRules(await api.getAlertRules()); } catch {}
  }, []);

  function loadAll() {
    loadActive();
    loadRules();
  }

  function switchTab(t: Tab) {
    setTab(t);
    if (t === "history") loadHistory();
    if (t === "rules") loadRules();
  }

  function handleGoToAlerts(e: React.MouseEvent) {
    e.preventDefault();
    navigateTo("/home/alerts", ALERTS_URL);
  }

  return (
    <ToastProvider>
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
            <BellRing className="size-5" />
          </span>
          <h1 className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.01em]">
            Alerts
            <Badge className="uppercase tracking-wide">Live</Badge>
          </h1>
        </div>
        <Button variant="outline" onClick={loadActive}>
          <RefreshCw />
          Refresh
        </Button>
      </header>

      {permsLoading ? null : !mayViewAlerts ? (
        <NoAccess />
      ) : (
        <>
          {backendOk === false && (
            <div className="flex items-center gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-2.5 text-[13px] text-[var(--danger-fg)]">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Backend is unavailable. Retrying…</span>
            </div>
          )}

          <Tabs value={tab} onValueChange={(v) => switchTab(v as Tab)}>
            <div className="border-b border-border bg-card px-6 py-2.5">
              <TabsList>
                <TabsTrigger value="active">
                  Active Alerts
                  {alertCount > 0 && (
                    <Badge className="ml-1.5 bg-[var(--destructive)] px-1.5 text-[10px] text-white">
                      {alertCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="history" onClick={() => { if (tab === "history") loadHistory(); }}>History</TabsTrigger>
                <TabsTrigger value="rules">Alert Rules</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="active">
              <ActiveAlerts alerts={activeAlerts} rules={rules} onRefresh={loadActive} />
            </TabsContent>
            <TabsContent value="history">
              <AlertHistory alerts={history} />
            </TabsContent>
            <TabsContent value="rules">
              <AlertRules rules={rules} onRefresh={loadRules} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </ToastProvider>
  );
}
