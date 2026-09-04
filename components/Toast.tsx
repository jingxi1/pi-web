"use client";

import { useSyncExternalStore } from "react";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  duration?: number;
  action?: ToastAction;
}

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
  action?: ToastAction;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let toasts: ToastItem[] = [];
let idSeq = 0;

const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 3500,
  success: 2500,
  warning: 5000,
  error: 6000,
};

function emit(): void {
  for (const listener of listeners) listener();
}

function pushToast(kind: ToastKind, message: string, options: ToastOptions = {}): string {
  const id = `t${++idSeq}`;
  const item: ToastItem = {
    id,
    kind,
    message,
    duration: options.duration ?? DEFAULT_DURATION[kind],
    action: options.action,
  };
  toasts = [...toasts, item];
  emit();
  if (item.duration > 0) {
    setTimeout(() => dismissToast(id), item.duration);
  }
  return id;
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function dismissAllToasts(): void {
  toasts = [];
  emit();
}

/** Imperative toast API, callable from anywhere (module-level singleton). */
export const toast = {
  info: (message: string, options?: ToastOptions) => pushToast("info", message, options),
  success: (message: string, options?: ToastOptions) => pushToast("success", message, options),
  warning: (message: string, options?: ToastOptions) => pushToast("warning", message, options),
  error: (message: string, options?: ToastOptions) => pushToast("error", message, options),
  dismiss: dismissToast,
  dismissAll: dismissAllToasts,
};

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => toasts
  );
}

export function ToastHost() {
  const items = useToasts();
  if (items.length === 0) return null;
  return (
    <div className="toast-host toast-host-anim" role="region" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <span className="toast-message">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action?.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
