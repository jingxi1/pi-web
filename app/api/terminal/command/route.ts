import { NextRequest, NextResponse } from "next/server";
import { runCommand } from "@/lib/terminal-command-runner";
import { resolveCwd } from "@/lib/terminal-manager";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { existsSync } from "fs";

// node-pty is a native module
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/terminal/command — execute a one-shot shell command
// body: { cwd: string, command: string, timeout?: number, sync?: boolean }
//
// sync=true (default): wait for the command to finish and return { stdout, exitCode }.
// sync=false: return immediately with { id }, client polls GET /api/terminal/command/:id.
export async function POST(req: NextRequest) {
  let body: { cwd?: unknown; command?: unknown; timeout?: unknown; sync?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }

  const requestedCwd = typeof body.cwd === "string" ? body.cwd : process.cwd();
  const { cwd } = resolveCwd(requestedCwd);

  // Security gate: resolved cwd must be inside an allowed root or a
  // container-internal directory.
  let allowed = isContainerInternalDir(cwd);
  if (!allowed) {
    const roots = await getAllowedFileRoots();
    allowed = isFilePathAllowed(cwd, roots);
  }
  if (!allowed) {
    return NextResponse.json({ error: "cwd is not in an allowed root" }, { status: 403 });
  }

  const timeoutMs = typeof body.timeout === "number" ? Math.max(5_000, Math.min(body.timeout, 300_000)) : 60_000;
  const sync = body.sync !== false; // default true

  const { id, promise } = runCommand(cwd, command, timeoutMs);

  if (!sync) {
    // Async: return the id, caller polls or waits
    return NextResponse.json({ id, cwd, command });
  }

  // Sync: wait for completion and return the result
  try {
    const result = await promise;
    return NextResponse.json({ id, cwd, command, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Container-side dirs that docker-compose itself mounts — safe to chdir into
 * without consulting the user's allowed-roots set.
 */
function isContainerInternalDir(dir: string): boolean {
  const candidates = [
    process.env.WORKSPACE_DIR,
    "/workspace",
    process.env.PI_CODING_AGENT_DIR,
    "/data/pi-agent",
    process.env.HOME,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return candidates.some((root) => {
    if (!existsSync(root)) return false;
    const norm = (s: string) => s.endsWith("/") ? s : s + "/";
    return dir === root || dir.startsWith(norm(root));
  });
}
