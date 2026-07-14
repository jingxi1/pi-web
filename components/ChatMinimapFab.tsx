"use client";

import { useEffect, useState, useMemo, useCallback, RefObject } from "react";
import type { AgentMessage, AssistantMessage, TextContent } from "@/lib/types";

interface Props {
  messages: AgentMessage[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
}

function getMessagePreview(msg: AgentMessage | Partial<AgentMessage>): string {
  if (msg.role === "user") {
    const content = msg.content;
    if (typeof content === "string") return content.slice(0, 120);
    if (Array.isArray(content)) {
      return (content as { type: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n")
        .slice(0, 120);
    }
    return "";
  }
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    const text = blocks
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    if (text) return text.slice(0, 120);
    const toolNames = blocks
      .filter((b) => b.type === "toolCall")
      .map((b) => (b as { type: string; toolName: string }).toolName);
    if (toolNames.length) return toolNames.join(", ");
    return "";
  }
  return "";
}

function hasTextContent(msg: AgentMessage | Partial<AgentMessage>): boolean {
  if (msg.role === "user") return true;
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    return blocks.some((b) => b.type === "text");
  }
  return false;
}

interface NodeItem {
  ref: HTMLDivElement | null;
  preview: string;
  isUser: boolean;
  index: number;
}

export function ChatMinimapFab({ messages, streamingMessage, messageRefs }: Props) {
  const [open, setOpen] = useState(false);

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : (messages as (AgentMessage | Partial<AgentMessage>)[])),
    [messages, streamingMessage]
  );

  const items: NodeItem[] = useMemo(() => {
    const refs = messageRefs.current;
    const out: NodeItem[] = [];
    let refIndex = 0;
    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const el = refs?.[refIndex];
      refIndex++;
      if (!hasTextContent(msg)) continue;
      out.push({
        ref: el ?? null,
        preview: getMessagePreview(msg) || "(empty)",
        isUser: msg.role === "user",
        index: out.length,
      });
    }
    return out;
  }, [allMessages, messageRefs]);

  // Close on Escape, refresh refs on mount
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleJump = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  }, []);

  if (items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? "Close message list" : "Jump to message"}
        aria-label={open ? "Close message list" : "Jump to message"}
        aria-expanded={open}
        style={{
          position: "fixed",
          bottom: 88,
          right: 16,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 40,
          minWidth: 40,
          padding: "0 12px",
          background: "var(--bg-panel)",
          color: "var(--text-muted)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        {items.length}
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 49,
              background: "rgba(0,0,0,0.25)",
            }}
          />
          <div
            role="dialog"
            aria-label="Message list"
            style={{
              position: "fixed",
              bottom: 140,
              right: 16,
              left: 16,
              maxHeight: "60vh",
              zIndex: 51,
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
              overflow: "hidden",
            }}
          >
            <div style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}>
              {items.length} message{items.length === 1 ? "" : "s"}
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {items.map((item) => (
                <button
                  key={item.index}
                  type="button"
                  onClick={() => handleJump(item.ref)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 14px",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    textAlign: "left",
                    color: "var(--text)",
                    fontSize: 12,
                    lineHeight: 1.4,
                    cursor: "pointer",
                    borderLeft: item.isUser ? "3px solid var(--accent)" : "3px solid transparent",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  <div style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {item.preview}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
