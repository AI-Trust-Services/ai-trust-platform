import React, { useState, useCallback, createContext, useContext } from "react";

interface Toast {
  id: number;
  message: string;
  isError: boolean;
}

interface ToastContextValue {
  showToast: (msg: string, isError?: boolean) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, isError = false) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, message, isError }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 left-1/2 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2.5 rounded-xl bg-foreground px-5 py-3 text-[13px] text-background shadow-[var(--shadow-md)] animate-in fade-in slide-in-from-bottom-2"
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: t.isError ? "var(--destructive)" : "var(--success)" }}
            />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
