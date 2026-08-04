import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { useLuigiInit } from "./hooks/useLuigi";
import { HEALTH_URL } from "./api/client";

type ToastFn = (msg: string, isError?: boolean) => void;

const ToastContext = createContext<ToastFn | null>(null);
export const useToast = () => useContext(ToastContext)!;

export default function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

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

  const showToast = useCallback<ToastFn>((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const activeView = location.pathname.startsWith("/roles") ? "roles" : "users";

  return (
    <ToastContext.Provider value={showToast}>
      <div className="page-header">
        <h1>Role Management <span className="mfe-badge">IAM</span></h1>
      </div>

      <div className="nav-tabs">
        <div
          className={`nav-tab${activeView === "users" ? " active" : ""}`}
          onClick={() => navigate("/users")}
        >
          Users
        </div>
        <div
          className={`nav-tab${activeView === "roles" ? " active" : ""}`}
          onClick={() => navigate("/roles")}
        >
          Roles &amp; Permissions
        </div>
      </div>

      {backendOk === false && (
        <div className="health-banner show">
          <span className="spinner" style={{ borderTopColor: "#8b0000", borderColor: "#f5b8b8", width: 14, height: 14 }} />
          <span>Backend is unavailable. Retrying in 5 s…</span>
          <a onClick={checkHealth}>Retry now</a>
        </div>
      )}

      <Outlet />

      {toast && (
        <div className={`toast show${toast.isError ? " error" : ""}`}>{toast.msg}</div>
      )}
    </ToastContext.Provider>
  );
}
