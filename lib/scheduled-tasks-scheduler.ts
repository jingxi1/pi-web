import { readTasks, writeTasks, computeNextRun, fillMissingNextRun } from "./scheduled-tasks-store";
import { runTask } from "./scheduled-tasks-runner";
import {
  HISTORY_LIMIT,
  RESULT_PREVIEW_CHARS,
  type ScheduledTask,
  type TaskRunRecord,
} from "./scheduled-tasks-types";

const TICK_INTERVAL_MS = 60_000;
const TICK_KEY = "__pi_web_scheduled_tasks_scheduler__";

interface SchedulerGlobal {
  started: boolean;
  timer: NodeJS.Timeout | null;
  ticking: boolean;
}

function getGlobal(): SchedulerGlobal {
  const g = globalThis as unknown as Record<string, SchedulerGlobal | undefined>;
  if (!g[TICK_KEY]) {
    g[TICK_KEY] = { started: false, timer: null, ticking: false };
  }
  return g[TICK_KEY] as SchedulerGlobal;
}

function buildRunRecord(at: string, result: { status: "success" | "error"; text: string; errorMessage?: string }): TaskRunRecord {
  if (result.status === "success") {
    const preview = result.text.length > 200 ? `${result.text.slice(0, 200)}…` : result.text;
    return { at, status: "success", summary: preview || "(无输出)" };
  }
  return { at, status: "error", summary: result.errorMessage ?? "未知错误" };
}

function applyRunResult(task: ScheduledTask, result: { status: "success" | "error"; text: string; errorMessage?: string }): ScheduledTask {
  const at = new Date().toISOString();
  const record = buildRunRecord(at, result);
  const truncatedResult = result.text.length > RESULT_PREVIEW_CHARS
    ? `${result.text.slice(0, RESULT_PREVIEW_CHARS)}…`
    : result.text;
  const history = [record, ...(task.history ?? [])].slice(0, HISTORY_LIMIT);
  return {
    ...task,
    lastRunAt: at,
    lastStatus: result.status,
    lastResult: result.status === "success" ? truncatedResult : (result.errorMessage ?? ""),
    history,
    nextRunAt: computeNextRun(task.schedule, new Date(at)),
    updatedAt: at,
  };
}

async function processDueTasks(): Promise<void> {
  const g = getGlobal();
  if (g.ticking) return;
  g.ticking = true;
  try {
    let tasks = await readTasks();
    const filled = fillMissingNextRun(tasks);
    if (filled.changed) {
      tasks = filled.tasks;
      await writeTasks(tasks);
    }
    const now = Date.now();
    const due = tasks.filter((t) => t.enabled && t.nextRunAt && Date.parse(t.nextRunAt) <= now);
    if (due.length === 0) return;

    for (const task of due) {
      try {
        const result = await runTask(task);
        const updated = applyRunResult(task, result);
        const all = await readTasks();
        const next = all.map((t) => (t.id === updated.id ? updated : t));
        await writeTasks(next);
      } catch (err) {
        const at = new Date().toISOString();
        const record: TaskRunRecord = {
          at,
          status: "error",
          summary: err instanceof Error ? err.message : String(err),
        };
        const all = await readTasks();
        const next = all.map((t) => {
          if (t.id !== task.id) return t;
          return {
            ...t,
            lastRunAt: at,
            lastStatus: "error" as const,
            lastResult: record.summary,
            history: [record, ...(t.history ?? [])].slice(0, HISTORY_LIMIT),
            nextRunAt: computeNextRun(t.schedule, new Date(at)),
            updatedAt: at,
          };
        });
        await writeTasks(next);
      }
    }
  } catch {
    // swallow to keep scheduler alive
  } finally {
    g.ticking = false;
  }
}

export function ensureScheduler(): void {
  const g = getGlobal();
  if (g.started) return;
  g.started = true;
  // Fire-and-forget bootstrap (fill nextRunAt for tasks missing it after a restart)
  void processDueTasks();
  g.timer = setInterval(() => {
    void processDueTasks();
  }, TICK_INTERVAL_MS);
  if (typeof g.timer.unref === "function") g.timer.unref();
}

export function stopScheduler(): void {
  const g = getGlobal();
  if (g.timer) {
    clearInterval(g.timer);
    g.timer = null;
  }
  g.started = false;
}
