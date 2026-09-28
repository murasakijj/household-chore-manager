import { createContext } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  tone?: "info" | "warning" | "error";
  action?: ToastAction;
  /** ミリ秒。省略時は既定値。 */
  durationMs?: number;
}

export interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | undefined>(
  undefined,
);
