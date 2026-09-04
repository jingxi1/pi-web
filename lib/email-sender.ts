import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { NotifyConfig, NotifySmtpConfig } from "./notify-types";

// Transporter instances are cached by credentials so repeated sends reuse a
// warmed connection pool. Cache lives on a module map (cleared on config change).
const transportMap = new Map<string, Transporter>();

/** For tests: reset the cached transporter instances. */
export function clearEmailTransporterCache(): void {
  transportMap.clear();
}

/** For tests: number of cached transporter instances. */
export function cachedTransportCount(): number {
  return transportMap.size;
}

export function isSmtpConfigured(smtp: NotifySmtpConfig): boolean {
  return Boolean(smtp.host && smtp.port && smtp.user);
}

function smtpKey(smtp: NotifySmtpConfig): string {
  return `${smtp.user}@${smtp.host}:${smtp.port}`;
}

function getTransporter(smtp: NotifySmtpConfig): Transporter {
  const key = smtpKey(smtp);
  let transporter = transportMap.get(key);
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    transportMap.set(key, transporter);
  }
  return transporter;
}

/**
 * Send an email notification. No-op (rather than throwing) when the feature is
 * disabled or the SMTP/addresses are incomplete.
 */
export async function sendNotifyEmail(
  config: NotifyConfig,
  payload: { subject: string; text: string; html?: string }
): Promise<void> {
  if (!config.enabled) return;
  if (!isSmtpConfigured(config.smtp)) return;
  if (!config.from || !config.to) return;
  const transporter = getTransporter(config.smtp);
  await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
}

/** Verify the SMTP connection for a config (throws on failure). */
export async function verifySmtp(smtp: NotifySmtpConfig): Promise<void> {
  if (!isSmtpConfigured(smtp)) throw new Error("SMTP config is incomplete");
  const transporter = getTransporter(smtp);
  await transporter.verify();
}

/** Send a real sample email so the user can confirm delivery end-to-end. */
export async function sendTestEmail(
  smtp: NotifySmtpConfig,
  opts: { from: string; to: string; subjectPrefix?: string }
): Promise<void> {
  if (!isSmtpConfigured(smtp)) throw new Error("SMTP config is incomplete");
  if (!opts.from || !opts.to) throw new Error("from and to are required");
  const prefix = (opts.subjectPrefix || "").trim();
  const subject = prefix ? `${prefix} 测试邮件` : "PiTools 测试邮件";
  const now = new Date().toLocaleString();
  const text = [
    "这是一封来自 PiTools 的测试邮件。",
    "如果你收到了这封邮件，说明 SMTP 通知配置可以正常发送邮件。",
    "",
    `发送时间：${now}`,
    `发送方：${opts.from}`,
  ].join("\n");
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;color:#222;max-width:600px">
  <h2 style="border-bottom:1px solid #eee;padding-bottom:8px">PiTools 测试邮件</h2>
  <p>如果你收到了这封邮件，说明 SMTP 通知配置可以正常发送邮件。</p>
  <table style="margin-top:12px;border-collapse:collapse">
    <tr><td style="padding:4px 12px 4px 0;color:#888">发送时间</td><td style="padding:4px 0">${now}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#888">发送方</td><td style="padding:4px 0">${opts.from}</td></tr>
  </table>
</div>`;
  await getTransporter(smtp).sendMail({
    from: opts.from,
    to: opts.to,
    subject,
    text,
    html,
  });
}
