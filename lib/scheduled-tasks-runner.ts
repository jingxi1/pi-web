import { randomUUID } from "crypto";
import { createTransport, type Transporter } from "nodemailer";
import { startRpcSession } from "./rpc-manager";
import { readNotifyConfig } from "./notify-config";
import type { NotifyConfig } from "./notify-types";
import type {
  RunTaskResult,
  ScheduledTask,
} from "./scheduled-tasks-types";

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;

const inFlight = new Set<string>();

function isInFlight(taskId: string): boolean {
  return inFlight.has(taskId);
}

function markInFlight(taskId: string): void {
  inFlight.add(taskId);
}

function clearInFlight(taskId: string): void {
  inFlight.delete(taskId);
}

interface WaitResult {
  ok: boolean;
  errorMessage?: string;
}

function waitForPromptDone(
  session: ReturnType<typeof startRpcSession> extends Promise<infer R> ? R extends { session: infer S } ? S : never : never,
  timeoutMs: number
): Promise<WaitResult> {
  return new Promise<WaitResult>((resolve) => {
    let settled = false;
    const finish = (r: WaitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsubscribe(); } catch { /* noop */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, errorMessage: "Prompt timed out" }), timeoutMs);
    const unsubscribe = session.onEvent((event) => {
      const t = (event as { type?: string }).type;
      if (t === "prompt_error") {
        const msg = (event as { errorMessage?: string }).errorMessage ?? "Prompt failed";
        finish({ ok: false, errorMessage: msg });
      } else if (t === "prompt_done") {
        finish({ ok: true });
      }
    });
  });
}

function getTransporter(config: NotifyConfig): Transporter {
  return createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

async function maybeSendEmail(task: ScheduledTask, text: string): Promise<{ sent: boolean; reason?: string }> {
  if (!task.email?.enabled) return { sent: false };
  const cfg = await readNotifyConfig();
  if (!cfg.enabled) return { sent: false, reason: "notify.json 邮件未启用" };
  if (!cfg.smtp?.host || !cfg.from) return { sent: false, reason: "SMTP 配置不完整" };
  const to = task.email.to?.trim() || cfg.to;
  if (!to) return { sent: false, reason: "未指定收件人" };

  try {
    const transporter = getTransporter(cfg);
    const subject = `${cfg.subjectPrefix ?? ""} [定时任务] ${task.name}`.trim();
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function runTask(task: ScheduledTask): Promise<RunTaskResult> {
  if (isInFlight(task.id)) {
    return {
      status: "error",
      text: "",
      durationMs: 0,
      errorMessage: "Task is already running",
    };
  }
  markInFlight(task.id);
  const started = Date.now();
  try {
    const tempKey = `__scheduled__${randomUUID()}`;
    const { session } = await startRpcSession(tempKey, "", task.cwd, undefined);

    if (task.model?.provider && task.model?.modelId) {
      try {
        await session.send({ type: "set_model", provider: task.model.provider, modelId: task.model.modelId });
      } catch (err) {
        return {
          status: "error",
          text: "",
          durationMs: Date.now() - started,
          errorMessage: `set_model failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    await session.send({ type: "prompt", message: task.prompt });
    const wait = await waitForPromptDone(session, PROMPT_TIMEOUT_MS);
    if (!wait.ok) {
      return {
        status: "error",
        text: "",
        durationMs: Date.now() - started,
        errorMessage: wait.errorMessage ?? "Prompt failed",
      };
    }

    const last = await session.send({ type: "get_last_assistant_text" }) as { text?: string } | null;
    const text = (last?.text ?? "").toString();

    await maybeSendEmail(task, text);

    return {
      status: "success",
      text,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      status: "error",
      text: "",
      durationMs: Date.now() - started,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearInFlight(task.id);
  }
}

export function isTaskRunning(taskId: string): boolean {
  return isInFlight(taskId);
}
