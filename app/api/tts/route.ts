import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// LAN TTS service (speechAZ, Azure Cognitive Services Speech).
// Override with PI_TTS_BASE_URL if the service moves.
const TTS_BASE_URL = process.env.PI_TTS_BASE_URL || "http://192.168.9.109:8020";
const TTS_ENDPOINT = `${TTS_BASE_URL.replace(/\/+$/, "")}/tts`;

// Service rejects text over 5000 chars with 413. Truncate defensively.
const MAX_TEXT_CHARS = 5000;

/**
 * Proxy a text-to-speech request to the local speechAZ service and return the
 * synthesized audio bytes. Kept server-side so the browser never talks to the
 * LAN service directly (avoids CORS and keeps the service URL configurable).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text, voice } = (body ?? {}) as { text?: unknown; voice?: unknown };
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "text is required and must be non-empty" }, { status: 400 });
  }

  const payload: Record<string, string> = {
    text: text.slice(0, MAX_TEXT_CHARS),
  };
  if (typeof voice === "string" && voice.trim().length > 0) {
    payload.voice = voice.trim();
  }
  // output_format omitted unless provided — service uses its MP3 default.

  try {
    const upstream = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok) {
      const upstreamText = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `TTS upstream error ${upstream.status}`, detail: upstreamText.slice(0, 500) },
        { status: 502 },
      );
    }

    const audio = await upstream.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `TTS request failed: ${message}` }, { status: 502 });
  }
}
