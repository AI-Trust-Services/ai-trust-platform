import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet } from "react-router-dom";
import { useLuigiInit } from "./hooks/useLuigi";
import { HEALTH_URL } from "./api/client";

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export default function App() {
  const [backendOk, setBackendOk] = useState(null);
  const [toast, setToast] = useState(null);
  const healthTimer = useRef(null);

  useLuigiInit(() => {});

  const checkHealth = useCallback(async () => {
    clearTimeout(healthTimer.current);
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
    return () => clearTimeout(healthTimer.current);
  }, [checkHealth]);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      <div className="page-header">
        <h1>Monitoring <span className="mfe-badge">Live</span></h1>
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
    </ToastContext.Provider>
  );
}
