import { subscribe, getTerminal } from "@/lib/terminal-manager";

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