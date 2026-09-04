"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  terminalId?: string;
  initialCwd?: string;
  onClose?: () => void;
}

interface SSEEvent {
  type?: string;
  id?: string;
  data?: string;
  replay?: boolean;
  exitCode?: number | null;
}

const CRT_THEME = {
  background: "#0a0e0a",
  foreground: "#7cfc00",
  cursor: "#ffb000",
  selectionBackground: "rgba(255,176,0,0.3)",
  black: "#0a0e0a",
  red: "#ff5555",
  green: "#7cfc00",
  yellow: "#ffb000",
  blue: "#4f9cff",
  magenta: "#ff7bd5",
  cyan: "#33d6c8",
  white: "#d0ffd0",
};

/** A self-contained floating terminal panel backed by the terminal API. */
export function TerminalView({ terminalId, initialCwd, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const idRef = useRef<string | null>(terminalId ?? null);
  const [resolvedId, setResolvedId] = useState<string | null>(terminalId ?? null);
  const [exited, setExited] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(true);

  // Ensure a terminal session exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (terminalId) {
        idRef.current = terminalId;
        return;
      }
      try {
        const res = await fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: initialCwd || undefined }),
        });
        const json = (await res.json()) as { id?: string; error?: string };
        if (!cancelled && res.ok && json.id) {
          idRef.current = json.id;
          setResolvedId(json.id);
        }
      } catch {
        // leave id unset; UI shows a connection error below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [terminalId, initialCwd]);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 2000,
      fontFamily: "var(--font-mono)",
      theme: CRT_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    term.focus();

    term.onData((data) => {
      const id = idRef.current;
      if (!id) return;
      void fetch(`/api/terminal/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "input", data }),
      });
    });

    const keydown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
        const sel = term.getSelection();
        if (sel) {
          e.preventDefault();
          void navigator.clipboard?.writeText(sel);
        }
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void navigator.clipboard?.readText().then((text) => {
          const id = idRef.current;
          if (id) {
            void fetch(`/api/terminal/${id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "input", data: text }),
            });
          }
        });
      }
    };
    const ta = containerRef.current.querySelector("textarea");
    ta?.addEventListener("keydown", keydown);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const id = idRef.current;
        if (id && term.cols && term.rows) {
          void fetch(`/api/terminal/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "resize", cols: term.cols, rows: term.rows }),
          });
        }
      } catch {
        // ignore transient layout races
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      ta?.removeEventListener("keydown", keydown);
      esRef.current?.close();
      esRef.current = null;
      term.dispose();
      termRef.current = null;
    };
    // terminalId intentionally omitted: the shell session is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect the SSE stream whenever the terminal id is resolved.
  useEffect(() => {
    if (!resolvedId) return;
    setExited(false);
    setConnecting(true);
    const es = new EventSource(`/api/terminal/${resolvedId}/events`);
    esRef.current = es;
    es.onmessage = (msg) => {
      const evt = JSON.parse(msg.data as string) as SSEEvent;
      const term = termRef.current;
      if (!term) return;
      if (evt.type === "connected") {
        setConnecting(false);
      } else if (evt.type === "data") {
        if (evt.replay) {
          term.reset();
          term.write(evt.data ?? "");
        } else {
          term.write(evt.data ?? "");
        }
      } else if (evt.type === "replay_end") {
        setConnecting(false);
      } else if (evt.type === "exit") {
        setExited(true);
        setExitCode(evt.exitCode ?? null);
        es.close();
        esRef.current = null;
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [resolvedId]);

  async function restart() {
    const id = idRef.current;
    if (!id) return;
    setExited(false);
    setConnecting(true);
    termRef.current?.reset();
    await fetch(`/api/terminal/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "continue" }),
    });
    const es = new EventSource(`/api/terminal/${id}/events`);
    esRef.current = es;
    es.onmessage = (msg) => {
      const evt = JSON.parse(msg.data as string) as SSEEvent;
      const term = termRef.current;
      if (!term) return;
      if (evt.type === "connected" || evt.type === "replay_end") setConnecting(false);
      else if (evt.type === "data") term.write(evt.data ?? "");
      else if (evt.type === "exit") {
        setExited(true);
        es.close();
        esRef.current = null;
      }
    };
  }

  return (
    <div style={styles.frame}>
      <div style={styles.toolbar}>
        <span style={styles.title}>终端 {resolvedId?.slice(0, 8) ?? ""}</span>
        <div style={styles.actions}>
          {exited && (
            <button style={styles.btn} onClick={() => void restart()}>
              重启
            </button>
          )}
          <button style={styles.btn} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
      <div style={styles.body} ref={containerRef}>
        {connecting && !exited && <div style={styles.notice}>连接中…</div>}
        {exited && (
          <div style={styles.notice}>
            进程已退出 (exit {exitCode ?? "?"}) · 按 Enter 重启
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  frame: {
    display: "flex",
    flexDirection: "column",
    width: "min(92vw, 880px)",
    height: "min(78vh, 620px)",
    background: "#0a0e0a",
    borderRadius: 10,
    overflow: "hidden",
    border: "1px solid #1e3a1e",
    fontFamily: "var(--font-mono)",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    background: "#0f160f",
    borderBottom: "1px solid #1e3a1e",
    color: "#7cfc00",
    fontSize: 12,
  },
  title: { opacity: 0.8 },
  actions: { display: "flex", gap: 6 },
  btn: {
    background: "none",
    border: "1px solid #2c4a2c",
    color: "#7cfc00",
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
  },
  body: { position: "relative", flex: 1, minHeight: 0, padding: 4 },
  notice: {
    position: "absolute",
    top: 8,
    left: 10,
    color: "#ffb000",
    fontSize: 12,
    zIndex: 5,
  },
};
