import { spawnRaw, resolveCwd } from "./terminal-manager";
import { getShellConfig } from "./terminal-manager";

// Completed command runs, kept briefly for async polling. Lives on globalThis
// for hot-reload persistence; entries are evicted 5 minutes after completion.
declare global {
  var __piCommandRuns: Map<string, CommandRunResult> | undefined;
}

export interface CommandRunResult {
  id: string;
  cwd: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  completedAt: number;
}

const RUN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 300_000;

function runs(): Map<string, CommandRunResult> {
  if (!globalThis.__piCommandRuns) globalThis.__piCommandRuns = new Map();
  return globalThis.__piCommandRuns as Map<string, CommandRunResult>;
}

function evict(): void {
  const now = Date.now();
  for (const [id, run] of runs()) {
    if (now - run.completedAt > RUN_TTL_MS) runs().delete(id);
  }
}

/** Fetch a previously completed command run, purging expired entries. */
export function getCommandRun(id: string): CommandRunResult | undefined {
  evict();
  return runs().get(id);
}

export async function runCommand(options: {
  cwd?: string;
  command: string;
  timeout?: number;
  id?: string;
}): Promise<CommandRunResult> {
  const command = options.command;
  if (!command || command.trim() === "") {
    throw new Error("command is required");
  }
  const cwd = await resolveCwd(options.cwd || process.cwd());
  const timeout = clamp(
    options.timeout ?? DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );
  const id = options.id ?? nextRunId();

  const shellConfig = getShellConfig();
  const proc = spawnRaw(shellConfig.shell, ["-c", command], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: shellConfig.env,
  });

  return new Promise<CommandRunResult>((resolve) => {
    let stdout = "";
    let settled = false;
    let timedOut = false;

    proc.onData((data: string) => {
      stdout += data;
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      const result: CommandRunResult = {
        id,
        cwd,
        command,
        stdout,
        stderr: "",
        exitCode: timedOut ? 124 : exitCode,
        timedOut,
        completedAt: Date.now(),
      };
      runs().set(id, result);
      evict();
      if (!settled) {
        settled = true;
        resolve(result);
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        // already gone
      }
    }, timeout);
    // Clear the timer reference if the promise path is unhandled elsewhere.
    timer.unref?.();
  });
}

export function nextRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, value));
}
