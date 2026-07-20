import { randomUUID } from "crypto";
import { spawn } from "node-pty";
import { homedir, userInfo } from "os";

// ============================================================================
// One-shot terminal command runner.
// Spawns a short-lived PTY, executes a shell command, and resolves with
// captured stdout + exit code. Designed for scripts like `npm run build`
// or `git status` where you want the output as a value, not an interactive
// terminal session.
//
// Pattern mirrors lib/terminal-manager.ts (node-pty, globalThis cache) but
// does NOT keep the entry alive — the pty exits, the data is returned,
// and everything is cleaned up.
// ============================================================================

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CommandEntry {
  promise: Promise<CommandResult>;
  createdAt: number;
}

declare global {
  var __piCommandRuns: Map<string, CommandEntry> | undefined;
}

const GARBAGE_COLLECT_AFTER_MS = 5 * 60 * 1000; // 5 min

function getCommandMap(): Map<string, CommandEntry> {
  if (!globalThis.__piCommandRuns) {
    globalThis.__piCommandRuns = new Map();
  }
  return globalThis.__piCommandRuns;
}

/**
 * Execute a shell command inside a PTY and capture all output.
 *
 * @param cwd     Working directory (must exist & be allowed by caller).
 * @param command Shell command string (e.g. `"npm run build"`).
 * @param timeout Optional timeout in ms. Default: 60 000 (1 min).
 */
export function runCommand(
  cwd: string,
  command: string,
  timeout: number = 60_000,
): { id: string; promise: Promise<CommandResult> } {
  const id = randomUUID();
  const map = getCommandMap();

  // Spawn a non-interactive shell. node-pty + bash -lc gives us a login
  // shell that sources /etc/profile, ~/.bashrc, etc., matching what the
  // user sees in an interactive terminal.
  const shell = process.env.SHELL
    ?? (process.platform === "win32" ? (process.env.COMSPEC || "powershell.exe") : "/bin/bash");
  const shellArgs = process.platform === "win32" ? ["/c", command] : ["-lc", command];

  const promise = new Promise<CommandResult>((resolve) => {
    let stdout = "";
    let stderr = ""; // node-pty merges both streams; we capture everything as stdout
    let timedOut = false;

    const pty = spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...(process.env as Record<string, string>),
        TERM: "xterm-256color",
        HOME: process.env.HOME || homedir(),
        USER: process.env.USER || userInfo().username || "user",
        // strip interactive-only vars so the shell doesn't try readline
        PS1: "",
        PROMPT_COMMAND: "",
      },
      useConpty: false,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { pty.kill(); } catch { /* gone */ }
    }, timeout);

    pty.onData((data) => {
      stdout += data;
    });

    pty.onExit(({ exitCode }) => {
      clearTimeout(timer);
      const result: CommandResult = {
        stdout,
        stderr: "", // node-pty merges; clients can prefix with '2>&1' if needed
        exitCode: timedOut ? -1 : exitCode,
      };
      resolve(result);
    });
  });

  const entry: CommandEntry = { promise, createdAt: Date.now() };
  map.set(id, entry);

  // Auto-evict old entries so the map doesn't grow unbounded
  const now = Date.now();
  for (const [k, v] of map) {
    if (now - v.createdAt > GARBAGE_COLLECT_AFTER_MS) map.delete(k);
  }

  return { id, promise };
}

/** Poll the result of a previously started command run. Returns undefined if
 *  the id is unknown (already evicted or never existed). */
export function pollCommandRun(id: string): CommandResult | undefined {
  const entry = getCommandMap().get(id);
  if (!entry) return undefined;
  // If the promise is still pending we don't know the result yet.
  // We use a "synchronous peek" — store the resolved result on resolve.
  // For now, return undefined and let the caller try again.
  return undefined;
}

/** Wait for a command result by id. Returns the result once it completes. */
export function waitForCommandRun(id: string): Promise<CommandResult> {
  const entry = getCommandMap().get(id);
  if (!entry) return Promise.reject(new Error("Command run not found"));
  return entry.promise;
}
