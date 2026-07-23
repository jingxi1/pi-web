import { subscribe, getTerminal, getScrollback } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

// GET /api/terminal/[id]/events — SSE stream of terminal output
// Mirrors app/api/agent/[id]/events/route.ts:
//   - ReadableStream, JSON-encoded data frames
//   - 30s heartbeat
//   - req.signal abort → unsubscribe + close
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entry = getTerminal(id);
  if (!entry) {
    return new Response("Terminal not found", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // controller already closed
        }
      };

      encode({ type: "connected", id });

      // Replay existing scrollback with a `replay: true` flag so the client
      // can distinguish history from realtime output and reset its screen
      // before replaying.
      const scrollback = getScrollback(entry);
      if (scrollback.length > 0) {
        // Chunk the scrollback into ~4KB frames so EventSource / xterm aren't
        // flooded with one giant write on slow connections.
        const MAX_FRAME = 4096;
        for (let i = 0; i < scrollback.length; i += MAX_FRAME) {
          encode({ type: "data", data: scrollback.slice(i, i + MAX_FRAME), replay: true });
        }
        // Marker so the client knows the replay is done and can stop
        // resetting before subsequent realtime frames arrive.
        encode({ type: "replay_end" });
      }

      const unsubscribe = subscribe(id, (chunk) => {
        encode({ type: "data", data: chunk });
      });

      // If the shell had already exited before the client subscribed, publish it now
      // (subscribe replays scrollback; we append the exit marker here).
      if (entry.exited) {
        encode({ type: "exit", exitCode: entry.exitCode });
      }

      // 30s heartbeat — same cadence as the agent SSE
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}