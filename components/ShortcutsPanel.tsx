"use client";

import { useEffect } from "react";

interface ShortcutEntry {
  keys: string[]; // each token rendered as its own <kbd>
  label: string;
  group: "Chat" | "Navigation" | "Sidebar" | "Input";
}

const SHORTCUTS: ShortcutEntry[] = [
  { keys: ["Enter"], label: "Send message", group: "Chat" },
  { keys: ["Shift", "Enter"], label: "Insert newline", group: "Chat" },
  { keys: ["Esc"], label: "Stop agent / close menus", group: "Chat" },
  { keys: ["Ctrl", "Alt", "N"], label: "New session in current project", group: "Navigation" },
  { keys: ["?"], label: "Toggle this shortcuts panel", group: "Navigation" },
  { keys: ["/"], label: "Slash commands in input", group: "Input" },
  { keys: ["@"], label: "Mention files in input", group: "Input" },
  { keys: ["Tab"], label: "Accept slash or file completion", group: "Input" },
  { keys: ["\u2191"], label: "Previous completion", group: "Input" },
  { keys: ["\u2193"], label: "Next completion", group: "Input" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsPanel({ open, onClose }: Props) {
  // Esc closes the panel when it's open
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const grouped = SHORTCUTS.reduce<Record<string, ShortcutEntry[]>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1700,
        background: "rgba(0, 0, 0, 0.42)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        animation: "shortcuts-panel-in 0.16s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "min(80vh, 540px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 24px 48px -12px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px 10px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              Keyboard shortcuts
            </span>
            <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              Press <Kbd>?</Kbd> any time to reopen
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, padding: 0,
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)", cursor: "pointer",
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
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10" />
              <line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "8px 4px 12px" }}>
          {Object.entries(grouped).map(([group, entries]) => (
            <section key={group} style={{ padding: "6px 12px 4px" }}>
              <h3
                style={{
                  margin: "8px 4px 4px",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {group}
              </h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {entries.map((entry) => (
                  <li
                    key={entry.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "6px 4px",
                      borderRadius: 6,
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--text)" }}>{entry.label}</span>
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      {entry.keys.map((k, i) => (
                        <span key={`${k}-${i}`} style={{ display: "inline-flex", gap: 4 }}>
                          {i > 0 && (
                            <span style={{ color: "var(--text-dim)", fontSize: 11, alignSelf: "center" }}>+</span>
                          )}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 22,
        height: 22,
        padding: "0 7px",
        border: "1px solid var(--border)",
        borderRadius: 5,
        background: "var(--bg-panel)",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0,
        boxShadow: "0 1px 0 color-mix(in srgb, var(--border) 70%, transparent)",
      }}
    >
      {children}
    </kbd>
  );
}

/**
 * Module-level registry so any component (notably AppShell) can mount the panel
 * and any hook can call `openShortcuts()` without prop drilling.
 */
let openListener: ((next: boolean) => void) | null = null;

export function setShortcutsPanelOpener(fn: ((next: boolean) => void) | null) {
  openListener = fn;
}

export function toggleShortcutsPanel() {
  openListener?.(true);
}
export function closeShortcutsPanel() {
  openListener?.(false);
}