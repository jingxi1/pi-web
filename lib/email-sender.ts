import { createTransport, type Transporter } from "nodemailer";
import type { NotifyConfig, NotifyEventType } from "./notify-types";

const transporterCache = new Map<string, Transporter>();

function getTransporterKey(config: NotifyConfig): string {
  return `${config.smtp.host}:${config.smtp.port}:${config.smtp.secure}:${config.smtp.user}:${config.smtp.pass}`;
}

function getTransporter(config: NotifyConfig): Transporter {
  const key = getTransporterKey(config);
  let t = transporterCache.get(key);
  if (!t) {
    t = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
    transporterCache.set(key, t);
  }
  return t;
}

export interface NotifyEmailOptions {
  event: NotifyEventType;
  subject: string;
  text: string;
  html?: string;
}

export async function sendNotifyEmail(config: NotifyConfig, opts: NotifyEmailOptions): Promise<void> {
  if (!config.enabled) return;
  if (!config.events[opts.event]) return;

  const transporter = getTransporter(config);
  const subject = config.subjectPrefix ? `${config.subjectPrefix} ${opts.subject}` : opts.subject;

  await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject,
    text: opts.text,
    html: opts.html,
  });
}

export async function testNotifyEmail(config: NotifyConfig): Promise<void> {
  const transporter = getTransporter(config);
  await transporter.verify();
}

export function clearEmailTransporterCache(): void {
  transporterCache.clear();
}
