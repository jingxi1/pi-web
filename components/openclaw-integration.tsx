"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NotifyConfig } from "./NotifyConfig";
import { ScheduledTasksConfig } from "./ScheduledTasksConfig";
import { MinimaxTokenPlanBar } from "./MinimaxTokenPlanBar";
import { useNotify } from "@/hooks/useNotify";
import type { AutoResumeEntry } from "@/lib/auto-resume-store";

/**
 * OpenClaw integration seam — the single point where fork-specific UI is wired
 * into AppShell. AppShell imports this component exactly once and renders it
 * once; everything else (toolbar tools menu, modals, token bar) lives
 * here.
 */

interface OpenClawIntegrationProps {
  /** Active provider id used to decide whether the token-plan bar renders. */
  providerId?: string | null;
  initialCwd?: string | null;
}

type ToolbarButton = "notify" | "tasks";

export function OpenClawIntegration({ providerId = null, initialCwd = null }: OpenClawIntegrationProps) {
  useNotify();

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsHostRef = useRef<HTMLElement | null>(null);
  const [detectedProvider, setDetectedProvider] = useState<string | null>(providerId);
  // Gate the document.body portal behind post-hydration mount so SSR output and
  // the first client render match (portal is absent from both).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // When no provider id is given, detect a minimax provider from the default
  // model so the token-plan bar can render without AppShell knowing anything.
  useEffect(() => {
    if (providerId) {
      setDetectedProvider(providerId);
      return;
    }
    let cancelled = false;
    fetch(`/api/models?cwd=${encodeURIComponent(initialCwd ?? "")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const dm = data.defaultModel as { provider?: string } | null;
        const p = dm?.provider ?? (Array.isArray(data.models) ? data.models[0]?.provider : undefined);
        if (typeof p === "string" && p.toLowerCase().includes("minimax")) {
          setDetectedProvider(p);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [providerId, initialCwd]);

  const handleAutoResume = useCallback((fired: AutoResumeEntry[]) => {
    // Queue a re-send of each fired prompt to its own session. Other sessions
    // are resumed directly against the agent API; the active one is handled by
    // useAgentSession's own triggerResume path.
    for (const entry of fired) {
      void fetch(`/api/agent/${encodeURIComponent(entry.sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "prompt", message: entry.lastPrompt }),
      }).catch(() => {});
    }
  }, []);

  // Mount the tools menu into the top-bar slot and close it on outside click.
  useEffect(() => {
    const slot = document.querySelector<HTMLElement>("[data-app-tools-slot]");
    toolsHostRef.current = slot ?? null;
    if (!toolsOpen) return;
    const onDown = (e: MouseEvent) => {
      const host = toolsHostRef.current;
      if (host && host.contains(e.target as Node)) return;
      setToolsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [toolsOpen]);

  const buttons: { key: ToolbarButton; label: string; open: boolean; onClick: () => void }[] = [
    { key: "notify", label: "通知", open: notifyOpen, onClick: () => setNotifyOpen(true) },
    { key: "tasks", label: "任务", open: tasksOpen, onClick: () => setTasksOpen(true) },
  ];

  const enabledBarProvider = detectedProvider || null;
  const slot = mounted ? toolsHostRef.current : null;

  // Toolbar content is portaled into AppShell's neutral `[data-app-tools-slot]`
  // so AppShell needs no structural knowledge of these features.
  return (
    <>
      {mounted && slot &&
        createPortal(
          <div style={toolsHostStyle} data-app-tools-host>
            <button
              type="button"
              style={toolsBtnStyle(toolsOpen)}
              onClick={() => setToolsOpen((open) => !open)}
              title="工具"
              aria-label="工具"
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: toolsOpen ? "var(--text)" : "var(--text-dim)", flexShrink: 0 }} aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span>工具</span>
            </button>
            {toolsOpen && (
              <div role="menu" style={menuStyle}>
                {buttons.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    role="menuitem"
                    style={menuItemStyle}
                    onClick={() => {
                      setToolsOpen(false);
                      b.onClick();
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
          </div>,
          slot
        )}
      <MinimaxTokenPlanBar
        providerId={enabledBarProvider}
        enabled={Boolean(enabledBarProvider)}
        onAutoResume={handleAutoResume}
      />
      <NotifyConfig open={notifyOpen} onClose={() => setNotifyOpen(false)} />
      <ScheduledTasksConfig open={tasksOpen} onClose={() => setTasksOpen(false)} />
    </>
  );
}

const toolsHostStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "stretch",
  height: "100%",
  flexShrink: 0,
  alignSelf: "stretch",
};

function toolsBtnStyle(open: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: "100%",
    padding: "0 12px",
    background: open ? "var(--bg-selected)" : "none",
    border: "none",
    borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
    borderRight: "1px solid var(--border)",
    cursor: "pointer",
    color: open ? "var(--text)" : "var(--text-muted)",
    fontSize: 11,
    whiteSpace: "nowrap",
    transition: "color 0.1s, background 0.1s",
  };
}

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  right: 0,
  minWidth: 140,
  zIndex: 900,
  display: "flex",
  flexDirection: "column",
  padding: 4,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderTop: "none",
  boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
};

const menuItemStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text, #e8e8e8)",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
};
