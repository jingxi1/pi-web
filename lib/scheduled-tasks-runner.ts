import { startRpcSession } from "@/lib/rpc-manager";
import type { AgentEvent } from "@/lib/rpc-manager";
import { readNotifyConfig } from "@/lib/notify-config";
import { sendNotifyEmail } from "@/lib/email-sender";
import type { ScheduledTask, TaskRunRecord } from "./scheduled-tasks-types";

// Set of task ids currently executing, so API writes that must not race a run
// (update/delete) can be rejected with 409. Lives on globalThis for hot-reload.
declare global {
  var __piScheduledTasksRunning: Set<string> | undefined;
}

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;

export function isTaskRunning(id: string): boolean {
  return globalThis.__piScheduledTasksRunning?.has(id) ?? false;
}

function setRunning(id: string, running: boolean): void {
  globalThis.__piScheduledTasksRunning ??= new Set();
  if (running) globalThis.__piScheduledTasksRunning.add(id);
  else globalThis.__piScheduledTasksRunning.delete(id);
}

interface PromptResult {
  status: "success" | "error";
  text: string;
  errorMessage?: string;
}

function waitForPromptDone(session: {
  onEvent(listener: (event: AgentEvent) => void): () => void;
}, timeoutMs: number): Promise<PromptResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: PromptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(result);
    };
    const timer = setTimeout(() => {
      settle({ status: "error", text: "", errorMessage: "Timed out waiting for the agent" });
    }, timeoutMs);
    const off = session.onEvent((event) => {
      if (event.type === "prompt_done") {
        settle({ status: "success", text: summaryText(event) });
      } else if (event.type === "prompt_error") {
        settle({
          status: "error",
          text: summaryText(event),
          errorMessage: "errorMessage" in event && typeof event.errorMessage === "string"
            ? event.errorMessage
            : "Agent reported an error",
        });
      }
    });
  });
}

/** Best-effort text snapshot from an event, for the email body. */
function summaryText(_event: AgentEvent): string {
  // The event itself does not carry the final transcript; the email uses a
  // fixed completion summary. Extend here if a richer transcript source appears.
  return "任务执行完成";
}

/** Execute a single scheduled task via a fresh RPC session. */
export async function runTask(task: ScheduledTask): Promise<TaskRunRecord> {
  if (isTaskRunning(task.id)) throw new Error("Task is already running");
  const startedAt = Date.now();

  setRunning(task.id, true);
  try {
    const cwd = task.cwd || process.cwd();
    const { session } = await startRpcSession(task.id, "", cwd, {});
    if (task.model) {
      await session.send({
        type: "set_model",
        provider: task.model.provider,
        modelId: task.model.modelId,
      });
    }
    await session.send({ type: "prompt", message: task.prompt });
    const result = await waitForPromptDone(session, PROMPT_TIMEOUT_MS);
    const durationMs = Date.now() - startedAt;
    const record: TaskRunRecord = {
      status: result.status,
      ranAt: new Date().toISOString(),
      durationMs,
      text: result.text,
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    };
    await maybeSendEmail(task, record);
    return record;
  } catch (error) {
    const record: TaskRunRecord = {
      status: "error",
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      text: "",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    await maybeSendEmail(task, record);
    return record;
  } finally {
    setRunning(task.id, false);
  }
}

async function maybeSendEmail(task: ScheduledTask, record: TaskRunRecord): Promise<void> {
  if (!task.email?.enabled) return;
  if (!task.email.to) return;
  const config = readNotifyConfig();
  if (!config.enabled || !config.smtp.host) return;

  const subject = `${config.subjectPrefix} 定时任务「${task.name || task.id}」${record.status === "success" ? "完成" : "失败"}`;
  const body = `任务: ${task.name || task.id}\n状态: ${record.status}\n耗时: ${Math.round(record.durationMs / 1000)}s\n\n${record.text || record.errorMessage || ""}`;
  try {
    await sendNotifyEmail({ ...config, to: task.email.to }, {
      subject,
      text: body,
      html: `<pre style="white-space:pre-wrap">${escapeHtml(body)}</pre>`,
    });
  } catch (error) {
    console.error("[pi-tools] task email send failed:", error instanceof Error ? error.message : error);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
