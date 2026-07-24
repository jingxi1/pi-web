"use client";

import { useEffect, useRef, useCallback } from "react";
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
  /** Set when the PTY shell exits; Enter continues, any other key kills the tab. */
  const isExitedRef = useRef(false);

  // Expose a stable ref for the copy/paste key handler so it doesn't need
  // to be re-registered each time aliveIdRef changes.
  const copyPasteIdRef = useRef<string | null>(null);
  copyPasteIdRef.current = aliveIdRef.current;

  // Write clipboard text into the PTY via POST input.
  const pasteToTerminal = useCallback((text: string) => {
    const id = copyPasteIdRef.current;
    if (!id) return;
    void fetch(`/api/terminal/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "input", data: text }),
    }).catch(() => { /* ignore */ });
  }, []);

  // CRT theme — green-on-dark with amber cursor + subtle phosphor glow.
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
    isExitedRef.current = false;

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

      // ---- copy / paste ----
      // Ctrl+Shift+C → copy selected text via Clipboard API
      // Ctrl+Shift+V → paste clipboard text into PTY
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return true;

        if (e.key === "C" || e.key === "c") {
          const sel = term.getSelection();
          if (sel) {
            void navigator.clipboard.writeText(sel);
            term.clearSelection();
          }
          return false;
        }
        if (e.key === "V" || e.key === "v") {
          void navigator.clipboard.readText().then(pasteToTerminal).catch(() => {});
          return false;
        }
        return true;
      });

      // ---- input keystroke forwarding ----
      term.onData((data) => {
        const id = aliveIdRef.current;
        if (!id) return;

        // When the shell is in "exited" state, we intercept keystrokes:
        //   Enter       → POST /continue (re-spawn the shell)
        //   anything else → POST /kill   (close the tab, the user can re-open)
        if (isExitedRef.current) {
          if (data === "\r") {
            isExitedRef.current = false;
            void fetch(`/api/terminal/${encodeURIComponent(id)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "continue" }),
            }).catch(() => { /* ignore */ });
          } else {
            // Kill the terminal; the parent's handleCloseFileTab will close the tab.
            void fetch(`/api/terminal/${encodeURIComponent(id)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "kill" }),
            }).catch(() => { /* ignore */ });
          }
          return; // don't forward to PTY
        }

        // Normal flow: forward keystroke to the live PTY
        void fetch(`/api/terminal/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "input", data }),
        }).catch(() => { /* network blip — ignore */ });
      });

      // ---- resize ----
      const sendResize = () => {
        const id = aliveIdRef.current;
        if (!id || !fitRef.current || !termRef.current) return;
        const cols = termRef.current.cols;
        const rows = termRef.current.rows;
        // Refuse 0x0 — node-pty's TIOCSWINSIZ rejects it on macOS and the
        // internal state goes bad until the next good resize.
        if (cols <= 0 || rows <= 0) return;
        void fetch(`/api/terminal/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resize", cols, rows }),
        }).catch(() => { /* ignore */ });
      };
      // Debounce: a drag of the panel splitter fires ResizeObserver on
      // every animation frame, and each call would round-trip POST /
      // resize to node-pty (SIOCSWINSIZ, which on macOS can stall for
      // ~50–100 ms when contended). 120 ms is invisible to humans but
      // cuts resize traffic ~10× during a drag.
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const ro = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* ignore */ }
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = null;
          sendResize();
        }, 120);
      });
      ro.observe(container);
      roRef.current = ro;

      // ---- spawn or attach ----
      let id = aliveIdRef.current;
      if (id) {
        // TerminalId came from localStorage restore — verify the backend still has it alive
        try {
          const res = await fetch(`/api/terminal/${encodeURIComponent(id)}`);
          if (!res.ok) {
            id = null; // 404 — terminal gone, fall through to create new
          } else {
            const status = await res.json() as { alive: boolean };
            if (!status.alive) id = null; // exited, can't continue
          }
        } catch {
          id = null; // network error — create fresh
        }
      }
      if (!id) {
        try {
          const res = await fetch("/api/terminal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cwd, cols: term.cols, rows: term.rows }),
          });
          if (!res.ok) {
            // Read the body even on error so we can surface the real cause
            // instead of a generic "HTTP 500". The server logs the full
            // stack; this gives the user something actionable in the UI.
            let detail = "";
            try {
              const errBody = await res.json() as { error?: string };
              if (errBody.error) detail = `: ${errBody.error}`;
            } catch { /* body wasn't JSON */ }
            term.write(`\r\n\x1b[31mFailed to spawn terminal (HTTP ${res.status})${detail}\x1b[0m\r\n`);
            return;
          }
          const data = await res.json() as {
            id: string;
            cwd: string;
            shell: string;
            requestedCwd?: string;
            fallbackReason?: string | null;
          };
          // Note: the fallbackReason banner is intentionally NOT written
          // here directly. The backend seeds the scrollback with the same
          // banner in spawnTerminal(), and the SSE replay (see below) will
          // hard-reset the screen and replay it. Writing it here too would
          // produce a visible flash where the first copy is wiped by reset().
          id = data.id;
          aliveIdRef.current = id;
          onTerminalId(id);
        } catch (err) {
          term.write(`\r\n\x1b[31mFailed to spawn terminal: ${String(err)}\x1b[0m\r\n`);
          return;
        }
      }

      // ---- SSE ----
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      const es = new EventSource(`/api/terminal/${encodeURIComponent(id)}/events`);
      // EventSource auto-reconnects after transient drops, and our backend
      // re-sends the full scrollback with `replay:true` on every (re)connect.
      // Without this flag the client would append the replay on top of the
      // already-displayed history — visually a flash and CPU-wise a full
      // xterm.js re-parse of the scrollback. Track connected/replay so we
      // hard-reset the screen on each (re)connect.
      let expectingReplay = false;
      es.onmessage = (e) => {
        if (!termRef.current) return;
        try {
          const payload = JSON.parse(e.data) as {
            type?: string;
            data?: string;
            exitCode?: number;
            replay?: boolean;
          };
          if (payload.type === "connected") {
            expectingReplay = true;
            return;
          }
          if (payload.type === "data" && typeof payload.data === "string") {
            if (expectingReplay) {
              // Hard reset: clear visible screen AND scrollback so we replay
              // the server's authoritative history from a clean slate.
              // `reset()` is cheaper than `clear()` + scrollback trim and
              // matches the server's scrollback as the source of truth.
              termRef.current.reset();
              expectingReplay = false;
            }
            termRef.current.write(payload.data);
          }
          if (payload.type === "replay_end") {
            expectingReplay = false;
          }
          if (payload.type === "exit") {
            expectingReplay = false;
            isExitedRef.current = true;
            termRef.current.write(
              `\r\n\x1b[2m[process exited${payload.exitCode != null ? ` with code ${payload.exitCode}` : ""}]\x1b[0m\r\n` +
              `\x1b[2m[Press \x1b[33mENTER\x1b[2m to restart, any other key to close]\x1b[0m\r\n`
            );
          }
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => { /* EventSource auto-reconnects */ };
      esRef.current = es;
    }

    void setup();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, cwd, pasteToTerminal]);

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