"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — lets non-React code (event handlers in hooks, api
// error fallbacks, etc.) push toasts without prop-drilling. The ToastHost
// subscribes once and renders the live queue.
// ---------------------------------------------------------------------------
type ToastKind = "info" | "success" | "warning" | "error";
type ToastAction = { label: string; onClick: () => void };

interface ToastEntry {
  id: string;
  message: string;
  kind: ToastKind;
  duration: number;
  action?: ToastAction;
}

type Listener = (toasts: ToastEntry[]) => void;

let toastQueue: ToastEntry[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function emit() {
  for (const cb of listeners) cb(toastQueue);
}

function pushToast(entry: Omit<ToastEntry, "id">): string {
  const id = `t${nextId++}`;
  toastQueue = [...toastQueue, { id, ...entry }];
  emit();
  return id;
}

function dismissToast(id: string) {
  toastQueue = toastQueue.filter((t) => t.id !== id);
  emit();
}

export interface ShowToastOptions {
  /** Milliseconds to stay on screen. Defaults to 4000. Pass 0 to require manual dismiss. */
  duration?: number;
  /** Optional action button (e.g. "Undo"). */
  action?: ToastAction;
}

export const toast = {
  info: (message: string, opts: ShowToastOptions = {}) =>
    pushToast({ message, kind: "info", duration: opts.duration ?? 4000, action: opts.action }),
  success: (message: string, opts: ShowToastOptions = {}) =>
    pushToast({ message, kind: "success", duration: opts.duration ?? 4000, action: opts.action }),
  warning: (message: string, opts: ShowToastOptions = {}) =>
    pushToast({ message, kind: "warning", duration: opts.duration ?? 5000, action: opts.action }),
  error: (message: string, opts: ShowToastOptions = {}) =>
    pushToast({ message, kind: "error", duration: opts.duration ?? 6000, action: opts.action }),
  dismiss: dismissToast,
};

const KIND_COLOR: Record<ToastKind, string> = {
  info: "var(--accent)",
  success: "#10b981",
  warning: "#d97706",
  error: "#ef4444",
};

/** Renders the global toast queue. Mount once near the app root. */
export function ToastHost() {
  const [toasts, setToasts] = useState<ToastEntry[]>(toastQueue);

  useEffect(() => {
    const cb: Listener = (next) => setToasts(next);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  // Per-card timers live inside ToastCard itself (so each card can pause on
  // hover). The host only tracks the queue and renders.

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      style={{
        position: "fixed",
        bottom: 18,
        right: 18,
        zIndex: 1500,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
        maxWidth: "min(92vw, 420px)",
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} entry={t} />
      ))}
    </div>
  );
}

function ToastCard({ entry }: { entry: ToastEntry }) {
  const [exiting, setExiting] = useState(false);
  const color = KIND_COLOR[entry.kind];

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => dismissToast(entry.id), 180);
  }, [entry.id]);

  // Pause auto-dismiss on hover so users have time to click the action.
  // Track the start time of the active timer so un-hovering resumes from the
  // exact remaining slice instead of restarting the full duration.
  const startedAtRef = useRef<number | null>(null);
  const remainingRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (entry.duration <= 0) return;
    if (paused) {
      // Snapshot remaining time when pausing.
      if (startedAtRef.current !== null) {
        const elapsed = Date.now() - startedAtRef.current;
        remainingRef.current = Math.max(0, (remainingRef.current ?? entry.duration) - elapsed);
        startedAtRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    const wait = remainingRef.current ?? entry.duration;
    remainingRef.current = null;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => dismissToast(entry.id), wait);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [paused, entry.duration, entry.id]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        boxShadow: "0 10px 28px -10px rgba(15,23,42,0.28), 0 2px 6px rgba(15,23,42,0.06)",
        color: "var(--text)",
        fontSize: 13,
        lineHeight: 1.45,
        pointerEvents: "auto",
        animation: exiting
          ? "toast-out 0.18s ease-in forwards"
          : "toast-in 0.22s cubic-bezier(0.32, 0.72, 0.18, 1.05) forwards",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 8,
          height: 8,
          marginTop: 6,
          borderRadius: "50%",
          background: color,
        }}
        aria-hidden="true"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ overflowWrap: "break-word" }}>{entry.message}</div>
        {entry.action && (
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => {
                entry.action?.onClick();
                dismiss();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                background: "transparent",
                border: `1px solid ${color}`,
                borderRadius: 6,
                color,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = color;
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = color;
              }}
            >
              {entry.action.label}
            </button>
            <button
              type="button"
              onClick={dismiss}
              style={{
                padding: "4px 8px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 500,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          padding: 0,
          background: "transparent",
          border: "none",
          color: "var(--text-dim)",
          cursor: "pointer",
          borderRadius: 4,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-dim)";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="2" y1="2" x2="10" y2="10" />
          <line x1="10" y1="2" x2="2" y2="10" />
        </svg>
      </button>
    </div>
  );
}