import { useCallback, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastOptions } from "../contexts/toast-context";

interface ActiveToast extends ToastOptions {
  id: number;
}

const DEFAULT_DURATION_MS = 5000;

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const timerRef = useRef<number | null>(null);
  const idRef = useRef(0);

  const showToast = useCallback((options: ToastOptions) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    idRef.current += 1;
    const id = idRef.current;
    setToast({ ...options, id });
    timerRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, options.durationMs ?? DEFAULT_DURATION_MS);
  }, []);

  const dismiss = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setToast(null);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="toast-wrap" role="status" aria-live="polite">
          <div className={`toast toast--${toast.tone ?? "info"}`}>
            <span className="toast-message">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              aria-label="閉じる"
              onClick={dismiss}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
