import { testNotifyEmail } from "@/lib/email-sender";
import { readNotifyConfig } from "@/lib/notify-config";
import { validateNotifyConfig } from "@/lib/notify-types";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = await readNotifyConfig();

  const err = validateNotifyConfig(config);
  if (err) {
    return Response.json({ error: err }, { status: 400 });
  }

  try {
    await testNotifyEmail(config);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
