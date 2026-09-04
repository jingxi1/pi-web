import { computeNextRun, readTasks, writeTasks } from "./scheduled-tasks-store";
import { runTask, isTaskRunning } from "./scheduled-tasks-runner";
import type { ScheduledTask } from "./scheduled-tasks-types";

// Global singleton so hot-reload / multiple imports share one tick loop.
declare global {
  var __pi_web_scheduled_tasks_scheduler__:
    | { timer: ReturnType<typeof setInterval> | null; start(): void; stop(): void; tick(): void }
    | undefined;
}

const TICK_MS = 60 * 1000;

interface Scheduler {
  timer: ReturnType<typeof setInterval> | null;
}

function buildScheduler(): Scheduler {
  return { timer: null };
}

/** Fill in a missing nextRunAt (disabled tasks stay null). */
export function fillMissingNextRun(task: ScheduledTask, now: Date = new Date()): void {
  if (!task.enabled) {
    task.nextRunAt = null;
    return;
  }
  if (!task.nextRunAt) {
    task.nextRunAt = computeNextRun(task.schedule, now).toISOString();
  }
}

/** Run every task whose nextRunAt is due and not currently running. */
export async function processDueTasks(now: Date = new Date()): Promise<void> {
  const tasks = readTasks();
  let changed = false;

  for (const task of tasks) {
    if (!task.enabled) continue;
    if (isTaskRunning(task.id)) continue;
    if (!task.nextRunAt) {
      fillMissingNextRun(task, now);
      changed = true;
      continue;
    }
    if (new Date(task.nextRunAt).getTime() <= now.getTime()) {
      const taskId = task.id;
      // Run without awaiting so a long task doesn't block the tick; the
      // in-flight guard in runTask prevents overlapping runs.
      void runTask(task).then((record) => {
        const fresh = readTasks();
        const target = fresh.find((t) => t.id === taskId);
        if (!target) return;
        target.lastRunAt = new Date().toISOString();
        target.lastResult = record;
        if (target.enabled) {
          target.nextRunAt = computeNextRun(target.schedule).toISOString();
        } else {
          target.nextRunAt = null;
        }
        writeTasks(fresh);
      });
    }
  }

  if (changed) writeTasks(tasks);
}

function start(): void {
  const s = globalThis.__pi_web_scheduled_tasks_scheduler__;
  if (!s) return;
  if (s.timer) return;
  tick();
  s.timer = setInterval(tick, TICK_MS);
}

function stop(): void {
  const s = globalThis.__pi_web_scheduled_tasks_scheduler__;
  if (!s || !s.timer) return;
  clearInterval(s.timer);
  s.timer = null;
}

export async function tick(): Promise<void> {
  try {
    await processDueTasks();
  } catch (error) {
    console.error("[pi-tools] scheduled scheduler tick failed:", error);
  }
}

/** Ensure the global scheduler singleton is running (called from instrumentation). */
export function startScheduler(): void {
  getOrCreateScheduler().start();
}

function getOrCreateScheduler(): NonNullable<typeof globalThis.__pi_web_scheduled_tasks_scheduler__> {
  if (!globalThis.__pi_web_scheduled_tasks_scheduler__) {
    globalThis.__pi_web_scheduled_tasks_scheduler__ = { timer: null, start, stop, tick };
  }
  return globalThis.__pi_web_scheduled_tasks_scheduler__;
}
