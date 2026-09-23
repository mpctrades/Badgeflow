import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastOptions = { isError?: boolean; duration?: number };
type ToastItem = { id: number; message: string; isError: boolean };

type ToastContextValue = {
  show: (message: string, opts?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// A bottom-center popup for confirming successful actions (save, delete,
// publish, etc.) — mounted once at the app shell so any route can call
// useToast() without wiring anything else up.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, opts?: ToastOptions) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, isError: opts?.isError ?? false }]);
    const duration = opts?.duration ?? 3200;
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        style={{
          position: "fixed",
          left: "50%",
          bottom: 24,
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "center",
          zIndex: 1000,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            style={{
              background: t.isError ? "#C1392B" : "#1F1F1F",
              color: "#fff",
              padding: "10px 20px",
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
              pointerEvents: "auto",
              whiteSpace: "nowrap",
              animation: "badgeflow-toast-in 0.18s ease-out",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes badgeflow-toast-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
