import { NextResponse } from "next/server";
import { spawnTerminal, TerminalError } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

/** POST — create a terminal session. */
export async function POST(request: Request) {
  let body: { cwd?: unknown; cols?: unknown; rows?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cwd = typeof body.cwd === "string" ? body.cwd : undefined;
  const cols = typeof body.cols === "number" ? body.cols : undefined;
  const rows = typeof body.rows === "number" ? body.rows : undefined;

  try {
    const session = await spawnTerminal({ cwd: cwd ?? "", cols, rows });
    return NextResponse.json({
      id: session.id,
      cwd: session.cwd,
      shell: session.shell,
    });
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
