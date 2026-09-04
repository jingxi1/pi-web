import { NextResponse } from "next/server";
import { readNotifyConfig } from "@/lib/notify-config";
import { sendNotifyEmail } from "@/lib/email-sender";
import type { NotifyEventType } from "@/lib/notify-types";

export const dynamic = "force-dynamic";

const EVENT_SUBJECTS: Record<NotifyEventType, string> = {
  agentEnd: "Agent 已完成",
  error: "Agent 报错",
  inputNeeded: "需要你的输入",
};

interface DispatchBody {
  event?: unknown;
  sessionId?: unknown;
  sessionName?: unknown;
  summary?: unknown;
  detail?: unknown;
}

/** POST — dispatch a notify event to email (skipped when disabled). */
export async function POST(request: Request) {
  let body: DispatchBody;
  try {
    body = (await request.json()) as DispatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { event, sessionId, sessionName, summary, detail } = body;
  const eventType = event as NotifyEventType;
  if (!event || !summary) {
    return NextResponse.json({ error: "event and summary are required" }, { status: 400 });
  }

  const config = readNotifyConfig();
  if (!config.enabled) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }
  if (!config.events[eventType]) {
    return NextResponse.json({ ok: true, skipped: "event-disabled" });
  }

  const sessionLabel =
    typeof sessionName === "string" && sessionName ? ` · ${sessionName}` :
    typeof sessionId === "string" && sessionId ? ` · ${sessionId.slice(0, 8)}` : "";
  const subject = `${config.subjectPrefix} ${EVENT_SUBJECTS[eventType]}${sessionLabel}`;

  const textDetail =
    typeof detail === "string" && detail ? `\n\n${detail}` : "";
  const htmlDetail = typeof detail === "string" && detail
    ? `<pre style="white-space:pre-wrap">${escapeHtml(detail)}</pre>` : "";

  try {
    await sendNotifyEmail(config, {
      subject,
      text: String(summary) + textDetail,
      html: `<p>${escapeHtml(String(summary))}</p>${htmlDetail}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
