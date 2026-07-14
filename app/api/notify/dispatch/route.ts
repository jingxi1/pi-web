import { readNotifyConfig } from "@/lib/notify-config";
import { sendNotifyEmail } from "@/lib/email-sender";
import { validateNotifyConfig } from "@/lib/notify-types";
import type { NotifyEventType } from "@/lib/notify-types";

export const dynamic = "force-dynamic";

interface DispatchRequest {
  event: NotifyEventType;
  sessionId?: string | null;
  sessionName?: string | null;
  summary: string;
  detail?: string;
}

const EVENT_SUBJECTS: Record<NotifyEventType, string> = {
  agentEnd: "Task completed",
  error: "Task error",
  inputNeeded: "Waiting for input",
};

function buildText(
  event: NotifyEventType,
  sessionId: string | null,
  sessionName: string | null,
  summary: string,
  detail?: string,
): { subject: string; text: string; html: string } {
  const subject = EVENT_SUBJECTS[event];
  const title = sessionName ? `${sessionName} - ${subject}` : subject;
  const idLine = sessionId ? `Session ID: ${sessionId}` : "";
  const summaryLine = `Summary: ${summary}`;
  const detailLine = detail ? `\nDetail:\n${detail}` : "";
  const text = `${title}\n\n${idLine ? idLine + "\n\n" : ""}${summaryLine}${detailLine}`;
  const html = `<h2>${title}</h2>${idLine ? `<p style="color:#666;">${idLine}</p>` : ""}<p><strong>${summaryLine}</strong></p>${detail ? `<pre style="white-space:pre-wrap;font-family:monospace;background:#f5f5f5;padding:12px;border-radius:4px;">${detail}</pre>` : ""}`;
  return { subject: title, text, html };
}

export async function POST(req: Request) {
  let body: DispatchRequest;
  try {
    body = await req.json() as DispatchRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.event || !body.summary) {
    return Response.json({ error: "event and summary are required" }, { status: 400 });
  }

  const config = await readNotifyConfig();

  const err = validateNotifyConfig(config);
  if (err) {
    return Response.json({ error: err }, { status: 400 });
  }

  if (!config.enabled) {
    return Response.json({ ok: true, skipped: "disabled" });
  }

  if (!config.events[body.event]) {
    return Response.json({ ok: true, skipped: "event-disabled" });
  }

  const { subject, text, html } = buildText(
    body.event,
    body.sessionId ?? null,
    body.sessionName ?? null,
    body.summary,
    body.detail,
  );

  try {
    await sendNotifyEmail(config, {
      event: body.event,
      subject,
      text,
      html,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
