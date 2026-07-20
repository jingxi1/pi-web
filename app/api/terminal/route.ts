import { NextRequest, NextResponse } from "next/server";
import { resolveCwd, spawnTerminal } from "@/lib/terminal-manager";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { existsSync } from "fs";

// node-pty is a native module — must run on Node.js runtime
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/terminal — create a new terminal session
// body: { cwd: string, cols?: number, rows?: number }
export async function POST(req: NextRequest) {
  let body: { cwd?: unknown; cols?: unknown; rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requested = typeof body.cwd === "string" ? body.cwd : "";
  if (!requested) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }

  // Resolve first so we validate the path the shell will actually chdir to.
  // Without this, a Windows-style path from the UI fails node-pty's chdir(2)
  // before the user even sees a prompt.
  const { cwd, fallbackReason } = resolveCwd(requested);

  // Security gate: when we resolved to a known container-side fallback, the
  // path is one docker-compose itself mounted — there's no host-controlled
  // directory traversal to worry about. For everything else, the cwd still
  // has to live under an allowed root.
  let allowed = isContainerInternalDir(cwd);
  if (!allowed) {
    const roots = await getAllowedFileRoots();
    allowed = isFilePathAllowed(cwd, roots);
  }
  if (!allowed) {
    return NextResponse.json({ error: "cwd is not in an allowed root" }, { status: 403 });
  }

  const cols = typeof body.cols === "number" && body.cols > 0 ? Math.floor(body.cols) : 120;
  const rows = typeof body.rows === "number" && body.rows > 0 ? Math.floor(body.rows) : 30;

  const result = spawnTerminal(cwd, cols, rows);
  return NextResponse.json({ ...result, requestedCwd: requested, fallbackReason });
}

/**
 * Container-side dirs that docker-compose itself mounts — safe to chdir into
 * without consulting the user's allowed-roots set, which only knows about
 * host-side paths from sessions.
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