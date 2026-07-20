"use client";

import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

interface Props {
  cwd: string;
  terminalId: string | null;
  onTerminalId: (id: string) => void;
}

export function TerminalView({ cwd, terminalId, onTerminalId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const aliveIdRef = useRef<string | null>(null);
  const disposedRef = useRef(false);

  // CRT theme — green-on-dark with amber cursor + subtle phosphor glow.
  // Toned-down colors (vs pure #00ff00) keep long sessions easy on the eyes.
  function readTheme(): NonNullable<ConstructorParameters<typeof import("@xterm/xterm").Terminal>[0]>["theme"] {
    return {
      background: "#0a0e0a",
      foreground: "#7cfc00",
      cursor: "#ffb000",
      cursorAccent: "#0a0e0a",
      selectionBackground: "rgba(124, 252, 0, 0.35)",
      selectionForeground: "#0a0e0a",
      black: "#0a0e0a",
      red: "#d96a6a",
      green: "#7cfc00",
      yellow: "#ffb000",
      blue: "#7aa6d9",
      magenta: "#b58fb8",
      cyan: "#7ac3b8",
      white: "#cfd6c4",
      brightBlack: "#5a6650",
      brightRed: "#ff8a8a",
      brightGreen: "#a6ff7c",
      brightYellow: "#ffd078",
      brightBlue: "#a8c8ff",
      brightMagenta: "#e2a8e2",
      brightCyan: "#a8e0d2",
      brightWhite: "#ffffff",
    };
  }

  useEffect(() => {
    disposedRef.current = false;
    aliveIdRef.current = terminalId;

    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
      if (termRef.current) {
        try { termRef.current.dispose(); } catch { /* ignore */ }
        termRef.current = null;
      }
      fitRef.current = null;
    };

    async function setup() {
      // Lazy-load xterm — it touches `window` and needs the client runtime.
      const [{ Terminal: TerminalCtor }, { FitAddon: FitAddonCtor }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      if (cancelled || disposedRef.current) return;

      const container = containerRef.current;
      if (!container) return;

      const theme = readTheme();
      const term = new TerminalCtor({
        fontFamily: "var(--font-ibm-plex-mono, \"IBM Plex Mono\", ui-monospace, Menlo, Consolas, monospace)",
        fontSize: 14,
        lineHeight: 1.5,
        cursorBlink: true,
        convertEol: true,
        allowProposedApi: true,
        scrollback: 5000,
        theme,
      });
      const fit = new FitAddonCtor();
      term.loadAddon(fit);
      term.open(container);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      // Forward keystrokes to the backend
      term.onData((data) => {
        const id = aliveIdRef.current;
        if (!id) return;
        void fetch(`/api/terminal/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "input", data }),
        }).catch(() => { /* network blip — ignore */ });
      });

      // Forward resize
      const sendResize = () => {
        const id = aliveIdRef.current;
        if (!id || !fitRef.current || !termRef.current) return;
        const cols = termRef.current.cols;
        const rows = termRef.current.rows;
        void fetch(`/api/terminal/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resize", cols, rows }),
        }).catch(() => { /* ignore */ });
      };
      const ro = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* ignore */ }
        sendResize();
      });
      ro.observe(container);
      roRef.current = ro;

      // Resolve which terminal id we'll be watching
      let id = aliveIdRef.current;
      if (!id) {
        // Spawn one for this cwd
        try {
          const res = await fetch("/api/terminal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cwd,
              cols: term.cols,
              rows: term.rows,
            }),
          });
          if (!res.ok) {
            term.write(`\r\n\x1b[31mFailed to spawn terminal (HTTP ${res.status})\x1b[0m\r\n`);
            return;
          }
          const data = await res.json() as {
            id: string;
            cwd: string;
            shell: string;
            requestedCwd?: string;
            fallbackReason?: string | null;
          };
          // If the server couldn't chdir to what we asked for, show it now so
          // the user sees the reason before the shell prompt — they'd otherwise
          // wonder why they're in /workspace instead of their project.
          if (data.fallbackReason) {
            term.write(`\r\n\x1b[33m[terminal]\x1b[0m ${data.fallbackReason}\r\n`);
            term.write(`\x1b[33m[terminal]\x1b[0m running in ${data.cwd} instead of ${data.requestedCwd}\r\n\r\n`);
          }
          id = data.id;
          aliveIdRef.current = id;
          onTerminalId(id);
        } catch (err) {
          term.write(`\r\n\x1b[31mFailed to spawn terminal: ${String(err)}\x1b[0m\r\n`);
          return;
        }
      }

      // Connect SSE — re-using a single EventSource per terminal id
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      const es = new EventSource(`/api/terminal/${encodeURIComponent(id)}/events`);
      es.onmessage = (e) => {
        if (!termRef.current) return;
        try {
          const payload = JSON.parse(e.data) as { type?: string; data?: string; exitCode?: number };
          if (payload.type === "connected") return;
          if (payload.type === "data" && typeof payload.data === "string") {
            termRef.current.write(payload.data);
          }
          if (payload.type === "exit") {
            termRef.current.write(`\r\n\x1b[2m[process exited${payload.exitCode != null ? ` with code ${payload.exitCode}` : ""}]\x1b[0m\r\n`);
            es.close();
            esRef.current = null;
          }
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => {
        // EventSource auto-reconnects; nothing to do here
      };
      esRef.current = es;
    }

    void setup();

    return cleanup;
    // We intentionally only re-init when the terminalId or cwd changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, cwd]);

  return (
    <div
      ref={containerRef}
      className="terminal-crt"
      style={{
        height: "100%",
        width: "100%",
        background: "#0a0e0a",
        padding: 10,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    />
  );
}