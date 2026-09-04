import { NextResponse } from "next/server";
import {
  runCommand,
  nextRunId,
} from "@/lib/terminal-command-runner";
import { TerminalError, resolveCwd } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

/** POST — run a one-off shell command, synchronously or in the background. */
export async function POST(request: Request) {
  let body: { cwd?: unknown; command?: unknown; timeout?: unknown; sync?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.command !== "string" || body.command.trim() === "") {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }
  const cwd = typeof body.cwd === "string" ? body.cwd : undefined;
  const timeout = typeof body.timeout === "number" ? body.timeout : undefined;
  const sync = body.sync !== false;

  let resolvedCwd: string;
  try {
    resolvedCwd = await resolveCwd(cwd || process.cwd());
  } catch (error) {
    if (error instanceof TerminalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  const id = nextRunId();

  try {
    if (!sync) {
      void runCommand({ cwd, command: body.command, timeout, id });
      return NextResponse.json({ id, cwd: resolvedCwd, command: body.command });
    }
    const result = await runCommand({ cwd, command: body.command, timeout, id });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TerminalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
