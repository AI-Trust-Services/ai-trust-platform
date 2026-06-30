import React, { useState, useEffect, useCallback } from "react";
import { api, HEALTH_URL, ALERTS_URL } from "./api/client";
import { useLuigiInit, navigateTo } from "./hooks/useLuigi";
import { ToastProvider } from "./components/Toast";
import { ActiveAlerts } from "./views/ActiveAlerts";
import { AlertHistory } from "./views/AlertHistory";
import { AlertRules } from "./views/AlertRules";
import type { AlertEvent, AlertRule } from "./types";

type Tab = "active" | "history" | "rules";

export default function App() {
  useLuigiInit(() => {});

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
      <div className="page-header">
        <h1>Alerts <span className="mfe-badge">Live</span></h1>
        <button className="btn-ghost" onClick={loadActive}>↺ Refresh</button>
      </div>

      {backendOk === false && (
        <div className="health-banner show">
          Backend is unavailable. Retrying…
        </div>
      )}

      <div className="nav-tabs">
        <div
          className={`nav-tab${tab === "active" ? " active" : ""}`}
          onClick={() => switchTab("active")}
        >
          Active Alerts{alertCount > 0 && (
            <span style={{
              marginLeft: 6, background: "#bb0000", color: "#fff",
              fontSize: 10, padding: "1px 6px", borderRadius: 8,
            }}>{alertCount}</span>
          )}
        </div>
        <div
          className={`nav-tab${tab === "history" ? " active" : ""}`}
          onClick={() => switchTab("history")}
        >
          History
        </div>
        <div
          className={`nav-tab${tab === "rules" ? " active" : ""}`}
          onClick={() => switchTab("rules")}
        >
          Alert Rules
        </div>
      </div>

      {tab === "active"  && <ActiveAlerts alerts={activeAlerts} rules={rules} onRefresh={loadActive} />}
      {tab === "history" && <AlertHistory alerts={history} />}
      {tab === "rules"   && <AlertRules   rules={rules}   onRefresh={loadRules} />}
    </ToastProvider>
  );
}
