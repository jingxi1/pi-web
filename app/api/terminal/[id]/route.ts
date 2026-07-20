import { NextRequest, NextResponse } from "next/server";
import {
  getTerminal,
  writeToTerminal,
  resizeTerminal,
  killTerminal,
} from "@/lib/terminal-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/terminal/[id] — input / resize / kill
// body: { action: "input" | "resize" | "kill", data?, cols?, rows? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getTerminal(id)) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  let body: { action?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (action === "input") {
    if (typeof body.data !== "string") {
      return NextResponse.json({ error: "data is required for input" }, { status: 400 });
    }
    const ok = writeToTerminal(id, body.data);
    return NextResponse.json({ ok });
  }

  if (action === "resize") {
    const cols = typeof body.cols === "number" ? Math.floor(body.cols) : 0;
    const rows = typeof body.rows === "number" ? Math.floor(body.rows) : 0;
    if (cols <= 0 || rows <= 0) {
      return NextResponse.json({ error: "cols and rows must be positive numbers" }, { status: 400 });
    }
    const ok = resizeTerminal(id, cols, rows);
    return NextResponse.json({ ok });
  }

  if (action === "kill") {
    const ok = killTerminal(id);
    return NextResponse.json({ ok });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}