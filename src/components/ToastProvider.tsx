import { useCallback, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastOptions } from "../contexts/toast-context";

interface ActiveToast extends ToastOptions {
  id: number;
}

const DEFAULT_DURATION_MS = 5000;
// レビュー指摘 #9: アクション付き(Undo等)のトーストは読んで押す時間を確保するため長めにする。
const DEFAULT_ACTION_DURATION_MS = 10000;

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const timerRef = useRef<number | null>(null);
  const idRef = useRef(0);
  const remainingMsRef = useRef(0);
  const startedAtRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, []);

  const startTimer = useCallback((ms: number, id: number) => {
    clearTimer();
    startedAtRef.current = Date.now();
    remainingMsRef.current = ms;
    timerRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, ms);
  }, []);

  const showToast = useCallback(
    (options: ToastOptions) => {
      idRef.current += 1;
      const id = idRef.current;
      setToast({ ...options, id });
      const duration =
        options.durationMs ??
        (options.action ? DEFAULT_ACTION_DURATION_MS : DEFAULT_DURATION_MS);
      startTimer(duration, id);
    },
    [startTimer],
  );

  // レビュー指摘 #9: ホバー/フォーカス中はタイマーを止め、読み終えてから再開する。
  const handlePause = () => {
    if (timerRef.current === null) return;
    remainingMsRef.current = Math.max(
      0,
      remainingMsRef.current - (Date.now() - startedAtRef.current),
    );
    clearTimer();
  };

  const handleResume = () => {
    if (!toast || timerRef.current !== null) return;
    startTimer(remainingMsRef.current || DEFAULT_DURATION_MS, toast.id);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* レビュー指摘 #9: live領域は常設し、トーストの中身だけ差し替える
          (マウント/アンマウントを繰り返すとスクリーンリーダーの読み上げが安定しないため)。 */}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toast && (
          <div
            className={`toast toast--${toast.tone ?? "info"}`}
            onMouseEnter={handlePause}
            onMouseLeave={handleResume}
            onFocus={handlePause}
            onBlur={handleResume}
          >
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
        )}
      </div>
    </ToastContext.Provider>
  );
}
