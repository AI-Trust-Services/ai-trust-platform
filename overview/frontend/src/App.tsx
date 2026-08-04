import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet } from "react-router-dom";
import { useLuigiInit, navigateTo } from "./hooks/useLuigi";
import { api, HEALTH_URL, ALERTS_URL, REGISTRY_URL } from "./api/client";
type ToastFn = (msg: string, isError?: boolean) => void;
const ToastContext = createContext<ToastFn | null>(null);
export const useToast = () => useContext(ToastContext)!;

interface HeaderControls {
  alertCount: number;
  registryUrl: string;
  alertsUrl: string;
  onNavigateAlerts: (e: React.MouseEvent) => void;
}
export const HeaderContext = createContext<HeaderControls | null>(null);
export const useHeader = () => useContext(HeaderContext)!;

export default function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [mayRegister, setMayRegister] = useState(false);
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLuigiInit(() => {});

  const checkHealth = useCallback(async () => {
    if (healthTimer.current) clearTimeout(healthTimer.current);
    try {
      const res = await fetch(HEALTH_URL, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setBackendOk(true);
    } catch {
      setBackendOk(false);
      healthTimer.current = setTimeout(checkHealth, 5000);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    return () => { if (healthTimer.current) clearTimeout(healthTimer.current); };
  }, [checkHealth]);

  useEffect(() => {
    api.myPermissions()
      .then(r => setMayRegister(r.permissions.includes("systems:write")))
      .catch(() => setMayRegister(false));
  }, []);

  const refreshAlertBadge = useCallback(async () => {
    try {
      const data = await api.getAlertCount();
      setAlertCount(data.count ?? 0);
    } catch { /* alerts backend may be unavailable */ }
  }, []);

  useEffect(() => {
    refreshAlertBadge();
    const id = setInterval(refreshAlertBadge, 30000);
    return () => clearInterval(id);
  }, [refreshAlertBadge]);

  const showToast = useCallback<ToastFn>((msg, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function handleNavigateAlerts(e: React.MouseEvent) {
    e.preventDefault();
    navigateTo("/home/alerts", ALERTS_URL);
  }

  return (
    <ToastContext.Provider value={showToast}>
      <HeaderContext.Provider value={{
        alertCount,
        registryUrl: REGISTRY_URL,
        alertsUrl: ALERTS_URL,
        onNavigateAlerts: handleNavigateAlerts,
      }}>
        <div className="page-header">
          <div className="header-left">
            <h1>Compliance Overview</h1>
            <p>Organisation compliance posture at a glance</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a href="#" style={{ textDecoration: "none" }} onClick={handleNavigateAlerts}>
              <button className={`alert-bell-btn${alertCount > 0 ? " has-errors" : ""}`}>
                Alerts
                {alertCount > 0 && <span className="alert-badge">{alertCount}</span>}
              </button>
            </a>
            <button className="btn-primary" onClick={() => { navigateTo("/home/ai-system-registry", REGISTRY_URL); }}
              disabled={!mayRegister} title={mayRegister ? undefined : "Requires permission: systems:write"}>
              + Register System
            </button>
          </div>
        </div>

        {backendOk === false && (
          <div className="health-banner show">
            <span className="spinner" style={{ borderTopColor: "#8b0000", borderColor: "#f5b8b8", width: 14, height: 14 }} />
            <span>Backend is unavailable. Retrying in 5 s…</span>
            <button className="btn-link" onClick={checkHealth}>Retry now</button>
          </div>
        )}

        <Outlet />

        {toast && (
          <div className={`toast show${toast.isError ? " error" : ""}`}>{toast.msg}</div>
        )}
      </HeaderContext.Provider>
    </ToastContext.Provider>
  );
}
