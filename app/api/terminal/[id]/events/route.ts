import { getTerminal, readScrollback, subscribeTerminal } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 30_000;
const REPLAY_CHUNK_BYTES = 16 * 1024;

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

/** GET — SSE live terminal stream with historical scrollback replay. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = getTerminal(id);
  if (!t) {
    return new Response(
      `data: ${JSON.stringify({ error: "Terminal not found" })}\n\n`,
      { status: 404, headers: SSE_HEADERS }
    );
  }

  const scrollback = readScrollback(id);
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => {
      c.enqueue(encode({ type: "connected", id }));

      // Replay historical scrollback in bounded chunks, then mark the boundary.
      const cursor = [0];
      while (cursor[0] < scrollback.length) {
        const end = Math.min(scrollback.length, cursor[0] + REPLAY_CHUNK_BYTES);
        c.enqueue(encode({ type: "data", data: scrollback.slice(cursor[0], end), replay: true }));
        cursor[0] = end;
      }
      c.enqueue(encode({ type: "replay_end" }));

      // If the process already exited before we connected, report it after replay.
      if (t.exited) {
        c.enqueue(encode({ type: "exit", exitCode: t.exitCode ?? null }));
        c.close();
        controller.abort();
        return;
      }

      const off = subscribeTerminal(id, (event) => {
        if (c.desiredSize == null) return;
        if (event.type === "data") {
          c.enqueue(encode({ type: "data", data: event.data ?? "" }));
        } else if (event.type === "exit") {
          c.enqueue(encode({ type: "exit", exitCode: event.exitCode ?? null }));
          c.close();
        }
      });

      const heartbeat = setInterval(() => {
        try {
          c.enqueue(new TextEncoder().encode(": keepalive\n\n"));
        } catch {
          // client gone; cleanup below
        }
      }, HEARTBEAT_MS);

      controller.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        off();
        try {
          c.close();
        } catch {
          // already closed
        }
      });
    },
    cancel: () => controller.abort(),
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
