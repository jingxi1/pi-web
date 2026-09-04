import { NextResponse } from "next/server";
import { createRequire } from "module";
import { getShellConfig } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

/** GET — probe the node-pty environment and report spawn success. */
export async function GET() {
  const probe: { ok: boolean; shell: string; exitCode?: number; error?: string | null } = {
    ok: false,
    shell: "unknown",
    error: null,
  };

  let name: string;
  try {
    const req = createRequire(import.meta.url);
    const pty = req("node-pty") as { spawn: (f: string, a: string[], o: Record<string, unknown>) => any };
    probe.ok = true;
    probe.shell = typeof pty.spawn === "function" ? "available" : "missing-spawn";
    if (typeof pty.spawn !== "function") {
      probe.ok = false;
      probe.error = "node-pty.spawn is not a function";
      return NextResponse.json(probe);
    }

    const shellConfig = getShellConfig();
    name = shellConfig.shell;
    probe.shell = name;

    // Spawn a trivial command and confirm it prints and exits 0.
    const exitCode = await new Promise<number>((resolve) => {
      const proc = pty.spawn(shellConfig.shell, ["-c", "echo ok"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: shellConfig.env,
      });
      proc.onExit(({ exitCode: code }: { exitCode: number }) => resolve(code));
    });
    probe.ok = exitCode === 0;
    probe.exitCode = exitCode;
    if (exitCode !== 0) probe.error = "echo failed";
    return NextResponse.json(probe);
  } catch (error) {
    probe.ok = false;
    probe.error = error instanceof Error ? error.message : String(error);
    return NextResponse.json(probe);
  }
}
