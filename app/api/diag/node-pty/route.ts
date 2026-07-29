import { NextResponse } from "next/server";

// node-pty is a native module
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/diag/node-pty — quick health check for the native PTY module.
export async function GET() {
  let ptyVersion: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("node-pty/package.json");
    ptyVersion = pkg.version;
  } catch {
    return NextResponse.json({ ok: false, error: "node-pty not installed" }, { status: 500 });
  }

  try {
    const ptySpawn = require("node-pty").spawn as (
      file: string,
      args: string[],
      options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
    ) => { onData: (cb: (d: string) => void) => void; onExit: (cb: (e: { exitCode: number }) => void) => void; write: (d: string) => void; kill: () => void };

    const result = await new Promise<{ ok: boolean; exitCode?: number; error?: string }>((resolve) => {
      try {
        const timeout = setTimeout(() => {
          try { pty.kill(); } catch { /* */ }
          resolve({ ok: false, error: "spawn timed out after 5 s" });
        }, 5_000);

        const pty = ptySpawn("echo", ["ok"], {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: "/tmp",
          env: { TERM: "xterm-256color", HOME: "/root", USER: "root" },
        });

        let output = "";
        pty.onData((data: string) => { output += data; });
        pty.onExit(({ exitCode }: { exitCode: number }) => {
          clearTimeout(timeout);
          resolve({ ok: exitCode === 0, exitCode });
        });
        pty.write("exit\r\n");
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });

    return NextResponse.json({
      ok: result.ok,
      exitCode: result.exitCode,
      error: result.error ?? null,
      ptyVersion,
      shell: process.env.SHELL || "/bin/bash",
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), ptyVersion }, { status: 500 });
  }
}
