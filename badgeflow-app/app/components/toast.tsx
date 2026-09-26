import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

type ToastOptions = { isError?: boolean; duration?: number };

type ToastContextValue = {
  show: (message: string, opts?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Confirmation toasts (save, delete, publish, …) use Shopify's own admin
// toast through App Bridge, so they look and behave like the rest of the
// admin. Mounted once at the app shell so any route can call useToast().
export function ToastProvider({ children }: { children: ReactNode }) {
  const shopify = useAppBridge();
  const show = useCallback(
    (message: string, opts?: ToastOptions) => {
      shopify.toast.show(message, { isError: opts?.isError ?? false, duration: opts?.duration ?? 5000 });
    },
    [shopify],
  );

  return <ToastContext.Provider value={{ show }}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
