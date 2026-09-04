import { existsSync } from "fs";
import { homedir } from "os";
import { createRequire } from "module";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";

// Registry lives on globalThis so Next.js hot-reload preserves live PTYs.
declare global {
  var __piTerminals: Map<string, TerminalSession> | undefined;
  var __piTerminalCleanupInstalled: boolean | undefined;
}

const SCROLLBACK_LIMIT_BYTES = 200 * 1024;
const SIGKILL_ESCALATION_MS = 1500;

export interface TerminalSession {
  id: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode: number | null;
  createdAt: number;
}

interface InternalSession extends TerminalSession {
  pty: any;
  chunks: string[];
  bytes: number;
  listeners: Set<(event: { type: "data" | "exit"; data?: string; exitCode?: number | null }) => void>;
  killTimer: NodeJS.Timeout | null;
}

type PtyModule = { spawn: (file: string, args: string[], opts: Record<string, unknown>) => any };

let ptyModule: PtyModule | undefined;

function loadPty(): PtyModule {
  if (ptyModule !== undefined) return ptyModule;
  try {
    // node-pty is CommonJS; resolve via createRequire to match its module shape.
    const req = createRequire(import.meta.url);
    ptyModule = req("node-pty") as PtyModule;
  } catch (error) {
    throw new Error(
      `node-pty could not be loaded: ${error instanceof Error ? error.message : error}`
    );
  }
  return ptyModule as PtyModule;
}

function registry(): Map<string, InternalSession> {
  if (!globalThis.__piTerminals) globalThis.__piTerminals = new Map();
  return globalThis.__piTerminals as Map<string, InternalSession>;
}

/** Unique terminal id. */
export function nextTerminalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Resolve shell path + args, adapting to zsh/bash and sourcing user rc files. */
export function getShellConfig(): { shell: string; args: string[]; env: Record<string, string> } {
  const env = { ...(process.env as Record<string, string>) };
  const base = env.SHELL || (process.platform === "win32" ? "bash" : "/bin/sh");
  const name = base.toLowerCase();
  if (name.includes("zsh")) {
    // zsh has no --rcfile; point ZDOTDIR at home so it reads ~/.zshrc.
    env.ZDOTDIR = env.ZDOTDIR || homedir();
    return { shell: base, args: ["-i"], env };
  }
  if (name.includes("bash")) {
    return { shell: base, args: ["-l", "-i"], env };
  }
  return { shell: base, args: ["-i"], env };
}

function getShellConfigForShell(shell: string): { shell: string; args: string[]; env: Record<string, string> } {
  const full = getShellConfig();
  return { shell, args: chooseArgs(shell), env: full.env };
}

function chooseArgs(shell: string): string[] {
  const name = shell.toLowerCase();
  if (name.includes("zsh")) return ["-i"];
  if (name.includes("bash")) return ["-l", "-i"];
  return ["-i"];
}

/** Walk the allowed-root check and choose a usable cwd (403/fallback semantics). */
export async function resolveCwd(requestedCwd: string | undefined): Promise<string> {
  // Empty/missing cwd (or a path that doesn't exist) falls back to a container
  // workspace or the user's home, per the API contract — never a hard error.
  if (!requestedCwd || requestedCwd.trim() === "" || !existsSync(requestedCwd)) {
    const candidates = [process.env.WORKSPACE_DIR, homedir()].filter(Boolean) as string[];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return homedir();
  }

  const cwd = requestedCwd;
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, roots)) {
    throw new TerminalError("cwd is not in an allowed root", 403);
  }
  return cwd;
}

/** Spawn a new terminal session. */
export async function spawnTerminal(options: {
  cwd: string;
  cols?: number;
  rows?: number;
}): Promise<TerminalSession> {
  const pty = loadPty();
  const cwd = await resolveCwd(options.cwd);
  const id = nextTerminalId();
  const cols = options.cols ?? 120;
  const rows = options.rows ?? 30;
  const shellConfig = getShellConfig();

  let proc: any;
  try {
    proc = pty.spawn(shellConfig.shell, shellConfig.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: shellConfig.env,
    });
  } catch (error) {
    throw new Error(
      `Failed to spawn terminal: ${error instanceof Error ? error.message : error}`
    );
  }

  const session: InternalSession = {
    id,
    cwd,
    shell: shellConfig.shell,
    cols,
    rows,
    exited: false,
    exitCode: null,
    createdAt: Date.now(),
    pty: proc,
    chunks: [],
    bytes: 0,
    listeners: new Set(),
    killTimer: null,
  };
  registry().set(id, session);
  installCleanup();

  proc.onData((data: string) => {
    appendScrollback(session, data);
    emitTo(session, { type: "data", data });
  });

  proc.onExit(({ exitCode }: { exitCode: number }) => {
    session.exited = true;
    session.exitCode = exitCode;
    if (session.killTimer) clearTimeout(session.killTimer);
    emitTo(session, { type: "exit", exitCode });
    // Keep the session (and its scrollback) available for replay/status.
  });

  return publicSession(session);
}

function emitTo(session: InternalSession, event: { type: "data" | "exit"; data?: string; exitCode?: number | null }): void {
  for (const listener of [...session.listeners]) {
    try {
      listener(event);
    } catch {
      // a misbehaving listener must not break the PTY loop
    }
  }
}

function appendScrollback(session: InternalSession, data: string): void {
  session.chunks.push(data);
  session.bytes += Buffer.byteLength(data, "utf8");
  while (session.bytes > SCROLLBACK_LIMIT_BYTES && session.chunks.length > 1) {
    session.bytes -= Buffer.byteLength(session.chunks.shift() as string, "utf8");
  }
}

export function getTerminal(id: string): TerminalSession | undefined {
  const s = registry().get(id);
  return s ? publicSession(s) : undefined;
}

function internal(id: string): InternalSession | undefined {
  return registry().get(id);
}

/** Full scrollback text (all retained chunks). */
export function readScrollback(id: string): string {
  return registry().get(id)?.chunks.join("") ?? "";
}

export function writeTerminal(id: string, data: string): { ok: boolean } {
  const s = internal(id);
  if (!s || s.exited) return { ok: false };
  s.pty.write(data);
  return { ok: true };
}

export function resizeTerminal(id: string, cols: number, rows: number): { ok: boolean } {
  const s = internal(id);
  if (!s || s.exited) return { ok: false };
  try {
    s.pty.resize(cols, rows);
    s.cols = cols;
    s.rows = rows;
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Re-spawn a shell under the same id (used after the process exits). */
export async function continueTerminal(id: string, cols?: number, rows?: number): Promise<{ ok: boolean }> {
  const s = internal(id);
  if (!s) return { ok: false };
  if (!s.exited) return { ok: true };

  const pty = loadPty();
  const shellConfig = getShellConfigForShell(s.shell);
  try {
    const proc = pty.spawn(s.shell, shellConfig.args, {
      name: "xterm-256color",
      cols: cols ?? s.cols,
      rows: rows ?? s.rows,
      cwd: s.cwd,
      env: shellConfig.env,
    });
    s.pty = proc;
    s.exited = false;
    s.exitCode = null;
    s.chunks = [];
    s.bytes = 0;
    s.killTimer = null;

    proc.onData((data: string) => {
      appendScrollback(s, data);
      emitTo(s, { type: "data", data });
    });
    proc.onExit(({ exitCode }: { exitCode: number }) => {
      s.exited = true;
      s.exitCode = exitCode;
      if (s.killTimer) clearTimeout(s.killTimer);
      emitTo(s, { type: "exit", exitCode });
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function killTerminal(id: string): { ok: boolean } {
  const s = internal(id);
  if (!s || s.exited) return { ok: Boolean(s && s.exited) };
  try {
    s.pty.kill();
    // On macOS, backgrounded children can shrug off SIGHUP; escalate to SIGKILL.
    s.killTimer = setTimeout(() => {
      if (!s.exited) {
        try {
          s.pty.kill();
        } catch {
          // already gone
        }
      }
    }, SIGKILL_ESCALATION_MS);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function subscribeTerminal(
  id: string,
  listener: (event: { type: "data" | "exit"; data?: string; exitCode?: number | null }) => void
): () => void {
  const s = internal(id);
  if (!s) return () => {};
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}

function publicSession(s: InternalSession): TerminalSession {
  return {
    id: s.id,
    cwd: s.cwd,
    shell: s.shell,
    cols: s.cols,
    rows: s.rows,
    exited: s.exited,
    exitCode: s.exitCode,
    createdAt: s.createdAt,
  };
}

/** Kill every live PTY on exit so no orphan shells outlive the server. */
function installCleanup(): void {
  if (globalThis.__piTerminalCleanupInstalled) return;
  globalThis.__piTerminalCleanupInstalled = true;
  process.on("exit", () => {
    for (const s of registry().values()) {
      if (!s.exited) {
        try {
          s.pty.kill();
        } catch {
          // ignore on shutdown
        }
      }
    }
  });
}

/** Minimal spawn helper exposed for the single-command runner. */
export function spawnRaw(
  file: string,
  args: string[],
  opts: Record<string, unknown>
): any {
  const pty = loadPty();
  return pty.spawn(file, args, opts);
}

export class TerminalError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export default { nextTerminalId, spawnTerminal };
