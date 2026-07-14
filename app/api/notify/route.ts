import { readNotifyConfig, writeNotifyConfig } from "@/lib/notify-config";
import { clearEmailTransporterCache } from "@/lib/email-sender";
import {
  type NotifyConfig,
  validateNotifyConfig,
  mergeWithDefaults,
  stripPassword,
} from "@/lib/notify-types";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readNotifyConfig();
  return Response.json(stripPassword(config));
}

export async function PUT(req: Request) {
  let body: NotifyConfig;
  try {
    body = await req.json() as NotifyConfig;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const merged = mergeWithDefaults(body);

  const err = validateNotifyConfig(merged);
  if (err) {
    return Response.json({ error: err }, { status: 400 });
  }

  // Preserve existing password if the sent one is empty (user didn't change it)
  if (!merged.smtp.pass) {
    const existing = await readNotifyConfig();
    merged.smtp.pass = existing.smtp.pass;
  }

  try {
    await writeNotifyConfig(merged);
    clearEmailTransporterCache();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  return Response.json(stripPassword(merged));
}
