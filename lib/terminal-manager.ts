import { randomUUID } from "crypto";
import { spawn, type IPty } from "node-pty";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { homedir, userInfo } from "os";
import { basename } from "path";

// ============================================================================
// PTY registry — mirrors lib/rpc-manager.ts patterns:
//   - globalThis cache (survives Next.js hot-reload)
//   - process-level cleanup on SIGINT/SIGTERM/exit
//   - subscribe(id, cb) returns an unsubscribe fn
// ============================================================================

interface TerminalEntry {
  pty: IPty;
  scrollbackChunks: string[];
  scrollbackLen: number;
  listeners: Set<(chunk: string) => void>;
  exited: boolean;
  exitCode: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  /** Path to this PTY's --rcfile (bash) or ZDOTDIR (zsh). Cleaned up on exit / kill. */
  rcPath: string;
  /** For zsh: the directory we created at $ZDOTDIR (also cleaned up). */
  zdotdir?: string;
}

declare global {
  var __piTerminals: Map<string, TerminalEntry> | undefined;
  var __piTerminalCleanupInstalled: boolean | undefined;
}

const SCROLLBACK_MAX = 200 * 1024; // 200 KB — enough for several screens
const SCROLLBACK_TRIM_AT = 250 * 1024; // start trimming when scrollback exceeds this
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

/**
 * Append a chunk to the ring-style scrollback and trim the head when the
 * total exceeds SCROLLBACK_TRIM_AT. O(amortised 1) per chunk — most pushes
 * never trigger a trim; trims happen at most once per push.
 *
 * Why not a plain string? `scrollback += chunk` plus the 200 KB slice()
 * every time we cross the limit is O(n) per over-limit push. With PTYs
 * streaming large output (`npm install`, `find /`, `cat big.log`) this
 * stalls the event loop for ~1–2 ms per slice, which on macOS manifests
 * as visible lag in the SSE heartbeat and POST /input.
 */
function appendScrollback(entry: TerminalEntry, chunk: string) {
  if (chunk.length === 0) return;
  // Edge case: a single chunk larger than the entire scrollback budget
  // (theoretically possible if node-pty's libuv buffer drains into one
  // onData callback after the process has been idle for a while). Slice
  // it down before pushing so the trim loop below can handle it normally
  // instead of bailing out because chunks.length === 1.
  if (chunk.length > SCROLLBACK_MAX) {
    chunk = chunk.slice(chunk.length - SCROLLBACK_MAX);
  }
  entry.scrollbackChunks.push(chunk);
  entry.scrollbackLen += chunk.length;
  if (entry.scrollbackLen <= SCROLLBACK_TRIM_AT) return;

  while (entry.scrollbackLen > SCROLLBACK_MAX && entry.scrollbackChunks.length > 1) {
    const head = entry.scrollbackChunks[0];
    const overflow = entry.scrollbackLen - SCROLLBACK_MAX;
    if (head.length <= overflow) {
      // Drop the entire head chunk.
      entry.scrollbackLen -= head.length;
      entry.scrollbackChunks.shift();
    } else {
      // Trim the head chunk in place; we're now back at SCROLLBACK_MAX.
      entry.scrollbackChunks[0] = head.slice(overflow);
      entry.scrollbackLen -= overflow;
      break;
    }
  }
}

/**
 * Materialise the scrollback to a single string. Called only when a new
 * SSE subscriber needs the full history (e.g. on reconnect / page refresh),
 * so the O(n) join cost is paid infrequently.
 */
export function getScrollback(entry: TerminalEntry): string {
  return entry.scrollbackChunks.join("");
}

/**
 * Build the env passed to every PTY we spawn. Centralised so spawnTerminal
 * and continueTerminal can't drift.
 *
 * The interesting bits are the macOS hang-prevention vars:
 *   GIT_TERMINAL_PROMPT=0  — git never blocks waiting for credentials
 *   GIT_ASKPASS=           — empty so a stray .bashrc `git fetch` fails fast
 *   GCM_INTERACTIVE=Never  — Git Credential Manager (cross-platform) quiet
 *   PI_TERM_NO_KEYCHAIN=1  — marker our future diagnostics can read
 *
 * We deliberately do NOT clear SSH_AUTH_SOCK; users with explicit agents
 * still want it. We only block the keychain *dialog* via the marker above.
 */
function buildPtyEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    HOME: process.env.HOME || homedir(),
    USER: process.env.USER || userInfo().username || "user",
    BASH_SILENCE_DEPRECATION: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GCM_INTERACTIVE: "Never",
    PI_TERM_NO_KEYCHAIN: "1",
  };
}

/**
 * Render the per-terminal rcfile that bash will source via `--rcfile`.
 * Sources the user's interactive setup so nvm / conda / starship / brew
 * shellenv / fzf etc. are actually available, then overrides PS1 to the
 * amber ▸ for CRT consistency.
 */
function renderBashRcfile(): string {
  return [
    `# Source user's interactive setup (nvm, conda, starship, brew shellenv, fzf)`,
    `for _pi_rc in "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.profile"; do`,
    `  if [ -f "$_pi_rc" ] && [ -r "$_pi_rc" ]; then`,
    `    . "$_pi_rc" || true`,
    `  fi`,
    `done`,
    `unset _pi_rc`,
    `PS1='\\[\\033[33m\\]▸ \\[\\033[0m\\]'`,
    `bind 'set show-all-if-ambiguous on' 2>/dev/null || true`,
  ].join("\n") + "\n";
}

/**
 * Render the zsh rcfile. zsh doesn't have a `--rcfile` flag — it always
 * sources `$ZDOTDIR/.zshrc` for interactive shells. The caller points
 * ZDOTDIR at a per-terminal directory (see spawnTerminal) and drops this
 * file there as `.zshrc`.
 */
function renderZshRcfile(): string {
  return [
    `# Source user's interactive setup (nvm, conda, starship, brew shellenv, fzf)`,
    `for _pi_rc in "$HOME/.zshrc" "$HOME/.zshenv" "$HOME/.zprofile" "$HOME/.profile"; do`,
    `  if [ -f "$_pi_rc" ] && [ -r "$_pi_rc" ]; then`,
    `    source "$_pi_rc" || true`,
    `  fi`,
    `done`,
    `unset _pi_rc`,
    `# Amber ▸ prompt — %F{220} is roughly the same hue as the bash version's \\033[33m`,
    `PROMPT='%F{220}▸%f '`,
    `# macOS ships a /etc/zshrc that only sets up completion when run under`,
    `# Apple Terminal; force compinit so tab-completion works in our PTY.`,
    `autoload -Uz compinit && compinit -u 2>/dev/null || true`,
    `bindkey '^[[Z' reverse-menu-complete 2>/dev/null || true`,
  ].join("\n") + "\n";
}

function resetIdleTimer(entry: TerminalEntry, _id: string) {
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
  // Linux/Docker first, Windows fallback for dev. macOS Catalina+ defaults
  // SHELL to /bin/zsh — zsh is handled below via ZDOTDIR instead of --rcfile.
  const shell = process.env.SHELL
    ?? (process.platform === "win32" ? (process.env.COMSPEC || "powershell.exe") : "/bin/bash");

  // Resolve here too in case spawnTerminal is called directly (tests, future
  // callers). The HTTP route resolves before validating; this is the safety net.
  const { cwd: effectiveCwd, fallbackReason } = resolveCwd(cwd);

  const env = buildPtyEnv();
  const id = randomUUID();
  const shellName = basename(shell);

  // Per-shell init strategy. bash has `--rcfile FILE`; zsh reads
  // $ZDOTDIR/.zshrc; sh/fish/others we leave alone.
  //
  // Without this branch, calling `/bin/zsh --rcfile FILE` either gets
  // treated as an unknown option (zsh prints "unknown option" to stderr
  // and exits non-zero on some builds) or silently ignored depending on
  // zsh version — either way, the PTY is unusable on stock macOS.
  let shellArgs: string[];
  let rcPath = "";
  let zdotdir: string | undefined;
  if (shellName === "bash" || shellName.endsWith("/bash")) {
    rcPath = `/tmp/.pi-term-init-${id}`;
    writeFileSync(rcPath, renderBashRcfile());
    shellArgs = ["--rcfile", rcPath];
  } else if (shellName === "zsh" || shellName.endsWith("/zsh")) {
    zdotdir = `/tmp/.pi-term-zsh-${id}`;
    mkdirSync(zdotdir, { recursive: true });
    writeFileSync(`${zdotdir}/.zshrc`, renderZshRcfile());
    // Override where zsh looks for its interactive rcfile.
    env.ZDOTDIR = zdotdir;
    shellArgs = [];
  } else {
    shellArgs = [];
  }

  const pty = spawn(shell, shellArgs, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: effectiveCwd,
    env,
    // useConpty: false forces winpty on Windows — better default for now
    useConpty: false,
  });

  const initialBanner = fallbackReason
    ? `\r\n\x1b[33m[terminal]\x1b[0m ${fallbackReason}\r\n\x1b[33m[terminal]\x1b[0m running in ${effectiveCwd} instead of ${cwd}\r\n\r\n`
    : "";

  const entry: TerminalEntry = {
    pty,
    scrollbackChunks: initialBanner ? [initialBanner] : [],
    scrollbackLen: initialBanner.length,
    listeners: new Set(),
    exited: false,
    exitCode: null,
    idleTimer: null,
    zdotdir,
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
    // source it again. For zsh, also wipe the per-terminal ZDOTDIR we made.
    try { unlinkSync(entry.rcPath); } catch { /* gone */ }
    if (entry.zdotdir) {
      try { rmSync(entry.zdotdir, { recursive: true, force: true }); } catch { /* gone */ }
    }
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
  // Remove from the map immediately so a new request sees the terminal as
  // gone; we still hold the local `entry` reference for the SIGKILL fallback.
  getMap().delete(id);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);

  try {
    entry.pty.kill();
  } catch { /* already gone */ }

  // macOS quirk: when the user has `&`-backgrounded a child inside the PTY,
  // the grand-child may hold the slave fd open. SIGHUP to the shell group
  // then sits there forever because the master fd never sees EOF, the
  // node-pty onData callback keeps firing (we keep appending scrollback and
  // trimming it), and the whole event loop stalls. Escalate to SIGKILL after
  // a short grace period.
  const forceTimer = setTimeout(() => {
    try { entry.pty.kill("SIGKILL"); } catch { /* gone */ }
    try { unlinkSync(entry.rcPath); } catch { /* already gone */ }
    if (entry.zdotdir) {
      try { rmSync(entry.zdotdir, { recursive: true, force: true }); } catch { /* gone */ }
    }
  }, 1500);
  if (typeof forceTimer.unref === "function") forceTimer.unref();

  try { unlinkSync(entry.rcPath); } catch { /* already gone */ }
  if (entry.zdotdir) {
    try { rmSync(entry.zdotdir, { recursive: true, force: true }); } catch { /* gone */ }
  }
  return true;
}

/**
 * Re-spawn the shell on an already-exited terminal entry, preserving its
 * id, cwd, and listeners so the existing SSE stream seamlessly continues.
 */
export function continueTerminal(id: string): boolean {
  const entry = getMap().get(id);
  if (!entry || !entry.exited) return false;

  // Clean up old rc file + zdotdir from the previous shell instance.
  try { unlinkSync(entry.rcPath); } catch { /* gone */ }
  if (entry.zdotdir) {
    try { rmSync(entry.zdotdir, { recursive: true, force: true }); } catch { /* gone */ }
  }

  const env = buildPtyEnv();
  const shellName = basename(entry.shell);

  // Mirror spawnTerminal's per-shell init strategy (bash --rcfile / zsh ZDOTDIR).
  let shellArgs: string[];
  let newRcPath = "";
  let newZdotdir: string | undefined;
  if (shellName === "bash" || shellName.endsWith("/bash")) {
    newRcPath = `/tmp/.pi-term-init-${id}-${Date.now()}`;
    writeFileSync(newRcPath, renderBashRcfile());
    shellArgs = ["--rcfile", newRcPath];
  } else if (shellName === "zsh" || shellName.endsWith("/zsh")) {
    newZdotdir = `/tmp/.pi-term-zsh-${id}-${Date.now()}`;
    mkdirSync(newZdotdir, { recursive: true });
    writeFileSync(`${newZdotdir}/.zshrc`, renderZshRcfile());
    env.ZDOTDIR = newZdotdir;
    shellArgs = [];
  } else {
    shellArgs = [];
  }

  entry.rcPath = newRcPath;
  entry.zdotdir = newZdotdir;

  const newPty = spawn(entry.shell, shellArgs, {
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
    try { unlinkSync(entry.rcPath); } catch { /* gone */ }
    if (entry.zdotdir) {
      try { rmSync(entry.zdotdir, { recursive: true, force: true }); } catch { /* gone */ }
    }
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