import { NextResponse } from "next/server";
import { readNotifyConfig } from "@/lib/notify-config";
import { isSmtpConfigured, verifySmtp, sendTestEmail } from "@/lib/email-sender";
import type { NotifySmtpConfig } from "@/lib/notify-types";

export const dynamic = "force-dynamic";

interface TestRequest {
  /** true = send a real sample email; omitted/false = only verify the connection. */
  send?: boolean;
  /** Form overrides (used to test the values currently being edited). */
  config?: {
    smtp?: Partial<NotifySmtpConfig>;
    from?: string;
    to?: string;
    subjectPrefix?: string;
  };
}

/**
 * Merge the saved config with the submitted form overrides.
 * A blank password in the form means "keep the saved one".
 */
function effectiveSmtp(saved: NotifySmtpConfig, override?: Partial<NotifySmtpConfig>): NotifySmtpConfig {
  const merged = { ...saved, ...(override ?? {}) };
  if ((override?.pass ?? "") === "") merged.pass = saved.pass;
  return merged;
}

/** POST — verify the saved SMTP connection, or send a sample test email. */
export async function POST(request: Request) {
  let body: TestRequest = {};
  try {
    body = (await request.json()) as TestRequest;
  } catch {
    body = {};
  }

  const saved = readNotifyConfig();
  const smtp = effectiveSmtp(saved.smtp, body.config?.smtp);

  if (body.send) {
    const from = body.config?.from || saved.from;
    const to = body.config?.to || saved.to;
    try {
      await sendTestEmail(smtp, { from, to, subjectPrefix: body.config?.subjectPrefix ?? saved.subjectPrefix });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, sent: true, to });
  }

  if (!isSmtpConfigured(smtp)) {
    return NextResponse.json({ error: "SMTP config is incomplete" }, { status: 400 });
  }
  try {
    await withTimeout(verifySmtp(smtp), SMTP_VERIFY_TIMEOUT_MS, "SMTP 连接超时");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}

const SMTP_VERIFY_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms).unref?.()
    ),
  ]);
}
