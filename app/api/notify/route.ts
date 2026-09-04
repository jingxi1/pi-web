import { NextResponse } from "next/server";
import { readNotifyConfig, writeNotifyConfig } from "@/lib/notify-config";
import {
  mergeWithDefaults,
  stripPassword,
  validateNotifyConfig,
} from "@/lib/notify-types";

export const dynamic = "force-dynamic";

/** GET — load the sanitized config (never returns the SMTP password). */
export async function GET() {
  const config = readNotifyConfig();
  return NextResponse.json(stripPassword(config));
}

/** PUT — save the config; a blank smtp.pass preserves the stored password. */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const merged = mergeWithDefaults((body ?? {}) as Parameters<typeof mergeWithDefaults>[0]);
  const validationError = validateNotifyConfig(merged);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  if (!merged.smtp.pass) {
    const existing = readNotifyConfig();
    if (existing.smtp.pass) merged.smtp.pass = existing.smtp.pass;
  }

  try {
    writeNotifyConfig(merged);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
  return NextResponse.json(stripPassword(merged));
}
