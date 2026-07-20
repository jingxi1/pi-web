import { randomUUID } from "crypto";
import { spawn, type IPty } from "node-pty";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { homedir, userInfo } from "os";

// ============================================================================
// PTY registry — mirrors lib/rpc-manager.ts patterns:
//   - globalThis cache (survives Next.js hot-reload)
//   - process-level cleanup on SIGINT/SIGTERM/exit
//   - subscribe(id, cb) returns an unsubscribe fn
// ============================================================================

interface TerminalEntry {
  pty: IPty;
  scrollback: string;
  listeners: Set<(chunk: string) => void>;
  exited: boolean;
  exitCode: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  /** Path to this PTY's --rcfile (cleaned up on exit / kill). */
  rcPath: string;
}

declare global {
  var __piTerminals: Map<string, TerminalEntry> | undefined;
  var __piTerminalCleanupInstalled: boolean | undefined;
}

const SCROLLBACK_MAX = 200 * 1024; // 200 KB — enough for several screens
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — same order as session-idle
const POST_EXIT_DELAY_MS = 5 * 60 * 1000; // keep exited entries around briefly for late subscribers

function getMap(): Map<string, TerminalEntry> {
  if (!globalThis.__piTerminals) {
    globalThis.__piTerminals = new Map();
  }
  if (!globalThis.__piTerminalCleanupInstalled) {
    globalThis.__piTerminalCleanupInstalled = true;
    const cleanup = () => {
      const map = globalThis.__piTerminals;
      if (!map) return;
      for (const entry of map.values()) {
        try { entry.pty.kill(); } catch { /* already gone */ }
      }
      map.clear();
    };
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piTerminals;
}

function appendScrollback(entry: TerminalEntry, chunk: string) {
  entry.scrollback += chunk;
  if (entry.scrollback.length > SCROLLBACK_MAX) {
    // Drop from the head — keep the tail so the most recent screen is visible
    entry.scrollback = entry.scrollback.slice(entry.scrollback.length - SCROLLBACK_MAX);
  }
}

function resetIdleTimer(entry: TerminalEntry, id: string) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    // Terminals persist until explicitly killed — no auto-cleanup here.
    // The timer is kept for its `.unref()` side-effect so it doesn't
    // keep the event loop alive indefinitely.
  }, IDLE_TIMEOUT_MS);
  if (typeof entry.idleTimer.unref === "function") entry.idleTimer.unref();
}

export interface SpawnResult {
  id: string;
  cwd: string;
  shell: string;
}

export function spawnTerminal(cwd: string, cols = DEFAULT_COLS, rows = DEFAULT_ROWS): SpawnResult {
  // Linux/Docker first, Windows fallback for dev
  const shell = process.env.SHELL
    ?? (process.platform === "win32" ? (process.env.COMSPEC || "powershell.exe") : "/bin/bash");

  // Resolve here too in case spawnTerminal is called directly (tests, future
  // callers). The HTTP route resolves before validating; this is the safety net.
  const { cwd: effectiveCwd, fallbackReason } = resolveCwd(cwd);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    HOME: process.env.HOME || homedir(),
    USER: process.env.USER || userInfo().username || "user",
    // Suppress bash's interactive intro on first start
    BASH_SILENCE_DEPRECATION: "1",
  };

  // Drop a per-terminal init file so we can override PS1 / behavior without
  // touching the user's `~/.bashrc`. bash's interactive startup reads
  // /etc/bash.bashrc + ~/.bashrc, which set their own PS1 and would override
  // an env-level PS1. `--rcfile` (per-shell) wins over both.
  const id = randomUUID();
  const rcPath = `/tmp/.pi-term-init-${id}`;
  writeFileSync(
    rcPath,
    [
      // Amber `▸ ` prompt — matches the rest of the CRT palette.
      `PS1='\\[\\033[33m\\]▸ \\[\\033[0m\\]'`,
      // Keep history, completion, etc. — the existing /etc/bash.bashrc is
      // sourced by /etc/profile.d/*.sh which we don't bypass by using
      // --rcfile. So just leave them and only override PS1 here.
      `bind 'set show-all-if-ambiguous on' 2>/dev/null || true`,
    ].join("\n") + "\n",
  );

  const pty = spawn(shell, ["--rcfile", rcPath], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: effectiveCwd,
    env,
    // useConpty: false forces winpty on Windows — better default for now
    useConpty: false,
  });

  const entry: TerminalEntry = {
    pty,
    scrollback: fallbackReason ? `\r\n\x1b[33m[terminal]\x1b[0m ${fallbackReason}\r\n\x1b[33m[terminal]\x1b[0m running in ${effectiveCwd} instead of ${cwd}\r\n\r\n` : "",
    listeners: new Set(),
    exited: false,
    exitCode: null,
    idleTimer: null,
    cwd: effectiveCwd,
    shell,
    cols,
    rows,
    rcPath,
  };

  pty.onData((data) => {
    appendScrollback(entry, data);
    for (const cb of entry.listeners) {
      try { cb(data); } catch { /* ignore listener errors */ }
    }
  });

  pty.onExit(({ exitCode }) => {
    entry.exited = true;
    entry.exitCode = exitCode;
    // Drop the per-terminal init file — node-pty's shell is gone, no one will
    // source it again.
    try { unlinkSync(rcPath); } catch { /* gone */ }
    // Tell subscribers the shell is gone — they decide what to render
    for (const cb of entry.listeners) {
      try { cb("\n[process exited]\n"); } catch { /* ignore */ }
    }
    // Keep the entry briefly so late subscribers can see exitCode
    setTimeout(() => {
      const map = globalThis.__piTerminals;
      if (map?.get(id) === entry) map.delete(id);
    }, POST_EXIT_DELAY_MS).unref();
  });

  getMap().set(id, entry);
  resetIdleTimer(entry, id);
  return { id, cwd: effectiveCwd, shell };
}

/**
 * Pick a directory that actually exists for `chdir`. Falls back through a chain
 * so a Windows-style path requested from inside a Linux container still
 * produces a usable terminal session.
 *
 * Exported so the HTTP route can resolve *before* running its allowed-roots
 * check — it's the resolved (container-side) path that needs to pass the gate,
 * not the host-side one the user clicked in the UI.
 */
export function resolveCwd(requested: string): { cwd: string; fallbackReason: string | null } {
  if (requested && existsSync(requested)) {
    return { cwd: requested, fallbackReason: null };
  }

  // Don't try to chdir to a host path that has no container-side equivalent.
  const looksLikeHostPath = /^[A-Za-z]:[\\/]/.test(requested) || /\\\\/.test(requested);

  const fallbacks = [
    process.env.WORKSPACE_DIR,
    "/workspace",
    process.env.PI_CODING_AGENT_DIR,
    process.env.HOME || homedir(),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  for (const candidate of fallbacks) {
    if (existsSync(candidate)) {
      const why = looksLikeHostPath
        ? `requested cwd "${requested}" is a host path with no container mount`
        : `requested cwd "${requested}" is not available inside the container`;
      return { cwd: candidate, fallbackReason: why };
    }
  }

  // Last resort: spawn in whatever node-pty's default would be (process cwd),
  // and let the shell decide. We always have something here.
  return { cwd: requested || process.cwd(), fallbackReason: null };
}

export function getTerminal(id: string): TerminalEntry | undefined {
  return getMap().get(id);
}

export function listTerminals(): { id: string; cwd: string; exited: boolean }[] {
  const out: { id: string; cwd: string; exited: boolean }[] = [];
  for (const [id, e] of getMap().entries()) {
    out.push({ id, cwd: e.cwd, exited: e.exited });
  }
  return out;
}

/**
 * Subscribe to a terminal's LIVE output. Returns an unsubscribe function.
 *
 * NOTE: scrollback is NOT replayed here — the SSE handler replays it explicitly
 * with a `replay: true` flag so clients can distinguish history from realtime.
 */
export function subscribe(id: string, cb: (chunk: string) => void): () => void {
  const entry = getMap().get(id);
  if (!entry) return () => {};
  entry.listeners.add(cb);
  resetIdleTimer(entry, id);
  return () => {
    entry.listeners.delete(cb);
    if (entry.listeners.size === 0) resetIdleTimer(entry, id);
  };
}

export function writeToTerminal(id: string, data: string): boolean {
  const entry = getMap().get(id);
  if (!entry || entry.exited) return false;
  try {
    entry.pty.write(data);
    return true;
  } catch {
    return false;
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const entry = getMap().get(id);
  if (!entry || entry.exited) return false;
  try {
    entry.pty.resize(cols, rows);
    entry.cols = cols;
    entry.rows = rows;
    return true;
  } catch {
    return false;
  }
}

export function killTerminal(id: string): boolean {
  const entry = getMap().get(id);
  if (!entry) return false;
  try {
    entry.pty.kill();
  } catch { /* ignore */ }
  try { unlinkSync(entry.rcPath); } catch { /* already gone */ }
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  getMap().delete(id);
  return true;
}

/**
 * Re-spawn the shell on an already-exited terminal entry, preserving its
 * id, cwd, and listeners so the existing SSE stream seamlessly continues.
 */
export function continueTerminal(id: string): boolean {
  const entry = getMap().get(id);
  if (!entry || !entry.exited) return false;

  // Clean up old rc file
  try { unlinkSync(entry.rcPath); } catch { /* gone */ }

  // New init file for the fresh shell
  const newRcPath = `/tmp/.pi-term-init-${id}-${Date.now()}`;
  writeFileSync(
    newRcPath,
    [
      `PS1='\\[\\033[33m\\]▸ \\[\\033[0m\\]'`,
      `bind 'set show-all-if-ambiguous on' 2>/dev/null || true`,
    ].join("\n") + "\n",
  );
  entry.rcPath = newRcPath;

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    HOME: process.env.HOME || homedir(),
    USER: process.env.USER || userInfo().username || "user",
    BASH_SILENCE_DEPRECATION: "1",
  };

  const newPty = spawn(entry.shell, ["--rcfile", newRcPath], {
    name: "xterm-256color",
    cols: entry.cols,
    rows: entry.rows,
    cwd: entry.cwd,
    env,
    useConpty: false,
  });

  // Wire up the new PTY — listeners from the old one receive data automatically
  newPty.onData((data) => {
    appendScrollback(entry, data);
    for (const cb of entry.listeners) {
      try { cb(data); } catch { /* ignore listener errors */ }
    }
  });

  newPty.onExit(({ exitCode }) => {
    entry.exited = true;
    entry.exitCode = exitCode;
    try { unlinkSync(newRcPath); } catch { /* gone */ }
    for (const cb of entry.listeners) {
      try { cb(`\n[process exited with code ${exitCode}]\n`); } catch { /* ignore */ }
    }
    // Keep briefly so late subscribers can see
    setTimeout(() => {
      const map = globalThis.__piTerminals;
      if (map?.get(id) === entry) map.delete(id);
    }, POST_EXIT_DELAY_MS).unref();
  });

  entry.pty = newPty;
  entry.exited = false;
  entry.exitCode = null;

  // Tell listeners the shell is back
  const banner = "\r\n\x1b[33m[terminal]\x1b[0m continued in interactive shell\r\n";
  appendScrollback(entry, banner);
  for (const cb of entry.listeners) {
    try { cb(banner); } catch { /* ignore */ }
  }

  return true;
}

export function killAllTerminals(): void {
  const map = globalThis.__piTerminals;
  if (!map) return;
  for (const id of [...map.keys()]) killTerminal(id);
}