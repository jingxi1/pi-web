"use client";

import { useState } from "react";

export interface MinimapMessage {
  id: string;
  preview: string;
  isUser: boolean;
}

interface ChatMinimapFabProps {
  messages: MinimapMessage[];
  /** Distance from viewport bottom = composer height + 8. */
  bottomOffset: number;
  onSelect?: (id: string) => void;
}

const FAB_SIZE = 40;
const GAP = 8;

/** Tablet-only floating minimap: a FAB that opens a jump-to-message list. */
export function ChatMinimapFab({ messages, bottomOffset, onSelect }: ChatMinimapFabProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div
          style={{ ...styles.backdrop, bottom: bottomOffset + FAB_SIZE + 12 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        />
      )}
      <button
        style={{ ...styles.fab, bottom: bottomOffset, zIndex: open ? 51 : 50 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="消息快速跳转"
        title="消息快速跳转"
      >
        {open ? "×" : "◫"}
      </button>
      {open && (
        <div
          className="oc-scroll-fab-panel"
          style={{ ...styles.panel, bottom: bottomOffset + FAB_SIZE + GAP + 12, zIndex: 51 }}
        >
          {messages.length === 0 && <div style={styles.empty}>暂无消息</div>}
          {messages.map((m) => (
            <button
              key={m.id}
              style={styles.item}
              onClick={() => {
                setOpen(false);
                onSelect?.(m.id);
              }}
            >
              <span style={{ ...styles.bullet, ...(m.isUser ? styles.userBullet : {}) }} />
              <span style={styles.preview}>{m.preview || "(无预览)"}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  fab: {
    position: "fixed",
    right: 16,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: 20,
    background: "var(--bg-panel, #1e1e1e)",
    border: "1px solid var(--bg-hover, #333)",
    color: "var(--text, #e8e8e8)",
    fontSize: 18,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    position: "fixed",
    right: 16,
    width: 260,
    background: "transparent",
    zIndex: 49,
    pointerEvents: "none",
  },
  panel: {
    position: "fixed",
    right: 16,
    width: 260,
    maxHeight: 320,
    overflowY: "auto",
    background: "var(--bg-panel, #1e1e1e)",
    border: "1px solid var(--bg-hover, #333)",
    borderRadius: 12,
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
    padding: 6,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  empty: { padding: 12, textAlign: "center", color: "var(--text-muted, #999)", fontSize: 13 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    borderRadius: 8,
    background: "none",
    border: "none",
    color: "var(--text, #e8e8e8)",
    textAlign: "left",
    cursor: "pointer",
    fontSize: 13,
    width: "100%",
  },
  bullet: { width: 3, borderRadius: 2, background: "transparent", alignSelf: "stretch" },
  userBullet: { background: "var(--accent, #60a5fa)" },
  preview: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
};
