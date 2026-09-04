"use client";

import { useEffect } from "react";

// Module-level singleton opener so SessionSidebar's "?" can open this panel
// without owning its open state.
let opener: (() => void) | null = null;

export function setShortcutsPanelOpener(fn: (() => void) | null): void {
  opener = fn;
}

export function toggleShortcutsPanel(): void {
  opener?.();
}

interface ShortcutEntry {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; items: ShortcutEntry[] }[] = [
  {
    title: "聊天 (Chat)",
    items: [
      { keys: ["Enter"], label: "发送消息" },
      { keys: ["Shift", "Enter"], label: "换行" },
      { keys: ["Esc"], label: "停止 agent / 关闭菜单" },
    ],
  },
  {
    title: "导航 (Navigation)",
    items: [
      { keys: ["Ctrl", "Alt", "N"], label: "当前项目新建 session" },
      { keys: ["?"], label: "切换快捷键面板" },
    ],
  },
  {
    title: "输入 (Input)",
    items: [
      { keys: ["/"], label: "输入斜杠命令" },
      { keys: ["@"], label: "输入文件提及" },
      { keys: ["Tab"], label: "接受自动完成" },
      { keys: ["↑", "↓"], label: "上一个 / 下一个完成项" },
    ],
  },
];

interface ShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsPanel({ open, onClose }: ShortcutsPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="oc-shortcuts-panel" style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>快捷键</h2>
          <button style={styles.close} onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div style={styles.body}>
          {GROUPS.map((group) => (
            <div key={group.title} style={styles.group}>
              <div style={styles.groupTitle}>{group.title}</div>
              {group.items.map((item, i) => (
                <div key={i} style={styles.row}>
                  <div style={styles.keys}>
                    {item.keys.map((k, j) => (
                      <span key={j} style={styles.key}>
                        {k}
                      </span>
                    ))}
                  </div>
                  <span style={styles.label}>{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  modal: {
    background: "var(--bg-panel, #1e1e1e)",
    color: "var(--text, #e8e8e8)",
    borderRadius: 12,
    padding: 20,
    width: 460,
    maxWidth: "92vw",
    maxHeight: "84vh",
    overflowY: "auto",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
    animation: "shortcuts-panel-in 0.18s ease-out",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 16, margin: 0 },
  close: { background: "none", border: "none", color: "inherit", fontSize: 22, cursor: "pointer" },
  body: { display: "flex", flexDirection: "column", gap: 14 },
  group: { display: "flex", flexDirection: "column", gap: 6 },
  groupTitle: { fontSize: 12, color: "var(--text-muted, #999)", textTransform: "uppercase", letterSpacing: 0.4 },
  row: { display: "flex", alignItems: "center", gap: 14, fontSize: 13 },
  keys: { display: "flex", gap: 4, minWidth: 120, flexWrap: "wrap" },
  key: {
    background: "var(--bg-subtle, #2a2a2a)",
    border: "1px solid var(--bg-hover, #333)",
    borderRadius: 5,
    padding: "2px 7px",
    fontSize: 12,
    fontFamily: "monospace",
  },
  label: { color: "var(--text, #e8e8e8)" },
};
