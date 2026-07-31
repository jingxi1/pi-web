"use client";

/**
 * OpenClaw Integration Boundary
 *
 * Single entry point for all OpenClaw features into AppShell.
 * See /OPENCLAW-INTEGRATION.md for the design rationale.
 *
 * Responsibilities:
 * - Register all OpenClaw-specific state (notify/tasks modal open, etc.)
 * - Subscribe to upstream notify events and dispatch them to /api/openclaw/notify/dispatch
 *   (was /api/notify/dispatch — see OPENCLAW-INTEGRATION.md §2 for the planned
 *    rename to /api/openclaw/...)
 * - Inject toolbar buttons into AppShell's toolbar via createPortal into the
 *   slot reserved by AppShell (id="openclaw-toolbar-slot")
 * - Render the OpenClaw modals (NotifyConfig, ScheduledTasksConfig) and the
 *   MinimaxTokenPlanBar
 *
 * Invariants (§1 of OPENCLAW-INTEGRATION.md):
 * - This is the only file that AppShell imports from OpenClaw
 * - AppShell.tsx contains exactly: `import { OpenClawIntegration } from "./openclaw-integration"`
 *   plus `<OpenClawIntegration />` in its JSX. Nothing else.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NotifyConfig } from "./NotifyConfig";
import { ScheduledTasksConfig } from "./ScheduledTasksConfig";
import { MinimaxTokenPlanBar } from "./MinimaxTokenPlanBar";
import { useNotify } from "@/hooks/useNotify";

interface Props {
  providerId: string | null;
}

export function OpenClawIntegration({ providerId }: Props) {
  // §1.2 Self-contained: all state lives here, not in AppShell
  const [notifyConfigOpen, setNotifyConfigOpen] = useState(false);
  const [tasksConfigOpen, setTasksConfigOpen] = useState(false);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);

  // §1.2 Self-contained: hook called inside the boundary
  useNotify();

  // §4.3 Option B: resolve the toolbar slot reserved by AppShell.
  // The slot is a placeholder `<div id="openclaw-toolbar-slot" />` AppShell
  // renders inside its toolbar. We poll once on mount because AppShell and
  // OpenClawIntegration mount independently — by the time useEffect runs,
  // the DOM should be ready.
  useEffect(() => {
    setToolbarSlot(document.getElementById("openclaw-toolbar-slot"));
  }, []);

  const toolbarButtons = (
    <>
      <button
        type="button"
        onClick={() => setNotifyConfigOpen(true)}
        title="Notify"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "100%", height: 32, padding: 0,
          background: "none", border: "none",
          color: "var(--text-muted)",
          borderRadius: 9, cursor: "pointer",
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setTasksConfigOpen(true)}
        title="Tasks"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "100%", height: 32, padding: 0,
          background: "none", border: "none",
          color: "var(--text-muted)",
          borderRadius: 9, cursor: "pointer",
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </button>
    </>
  );

  return (
    <>
      {/* Toolbar buttons via portal — see §4.3 */}
      {toolbarSlot
        ? createPortal(toolbarButtons, toolbarSlot)
        // Fallback: render inline at body root if slot not ready yet.
        // Should be invisible in practice (slot mounts first).
        : createPortal(toolbarButtons, document.body)
      }

      {/* Token quota bar — driven by providerId from AppShell via ChatWindow.onSelectedModelChange */}
      <MinimaxTokenPlanBar enabled={providerId === "minimax-cn"} />

      {/* Modals */}
      {notifyConfigOpen && (
        <NotifyConfig onClose={() => setNotifyConfigOpen(false)} />
      )}
      {tasksConfigOpen && (
        <ScheduledTasksConfig onClose={() => setTasksConfigOpen(false)} />
      )}
    </>
  );
}