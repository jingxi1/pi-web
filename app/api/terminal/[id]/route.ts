import { NextResponse } from "next/server";
import {
  getTerminal,
  writeTerminal,
  resizeTerminal,
  killTerminal,
  continueTerminal,
} from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

/** GET — inspect terminal status. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = getTerminal(id);
  if (!t) {
    return NextResponse.json({ alive: false, exited: true });
  }
  return NextResponse.json({
    alive: !t.exited,
    exited: t.exited,
    cwd: t.cwd,
    exitCode: t.exited ? t.exitCode : null,
  });
}

/** POST — control a terminal (input / resize / continue / kill). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = getTerminal(id);
  if (!t) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  let body: { action?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  switch (body.action) {
    case "input": {
      if (typeof body.data !== "string") {
        return NextResponse.json({ error: "data is required" }, { status: 400 });
      }
      const res = writeTerminal(id, body.data);
      return NextResponse.json({ ok: res.ok });
    }
    case "resize": {
      const cols = typeof body.cols === "number" ? body.cols : 0;
      const rows = typeof body.rows === "number" ? body.rows : 0;
      if (cols < 1 || rows < 1) {
        return NextResponse.json({ error: "cols and rows are required" }, { status: 400 });
      }
      const res = resizeTerminal(id, cols, rows);
      return NextResponse.json({ ok: res.ok });
    }
    case "continue": {
      const res = await continueTerminal(id);
      return NextResponse.json({ ok: res.ok });
    }
    case "kill": {
      const res = killTerminal(id);
      return NextResponse.json({ ok: res.ok });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
