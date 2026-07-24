import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { loadFavorites } from "@/lib/favorites-store";

export async function GET() {
  try {
    const [sessions, favoriteIds] = await Promise.all([
      listAllSessions(),
      loadFavorites(),
    ]);
    return NextResponse.json({
      sessions,
      runningSessionIds: getRunningRpcSessionIds(),
      favoriteSessionIds: [...favoriteIds],
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
