import { NextResponse } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";

// GET /api/cwd/known-roots：返回系统当前允许/已知的目录（各会话 cwd、projectRoot 等）。
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const roots = await getAllowedFileRoots();
    return NextResponse.json({ roots: [...roots].sort() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
