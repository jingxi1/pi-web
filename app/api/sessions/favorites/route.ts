import { NextResponse } from "next/server";
import { loadFavorites, setFavorite } from "@/lib/favorites-store";

export const dynamic = "force-dynamic";

// GET /api/sessions/favorites → returns the current favorite session IDs.
export async function GET() {
  try {
    const ids = await loadFavorites();
    return NextResponse.json({ favoriteSessionIds: [...ids] });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/sessions/favorites  body: { sessionId: string, favorite?: boolean }
// Returns the resulting favorite state. Omit `favorite` (or use null/undefined)
// to toggle.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string;
      favorite?: boolean | null;
    };
    if (typeof body.sessionId !== "string" || !body.sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const { sessionId } = body;
    let favorite: boolean;
    if (typeof body.favorite === "boolean") {
      favorite = body.favorite;
    } else {
      const current = await loadFavorites();
      favorite = !current.has(sessionId);
    }
    const result = await setFavorite(sessionId, favorite);
    return NextResponse.json({ ok: true, sessionId, favorite: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}