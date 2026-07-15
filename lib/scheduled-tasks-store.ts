import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  type ScheduledTask,
  type ScheduledTasksFile,
  type TaskSchedule,
} from "./scheduled-tasks-types";
import { nextCronRun, validateCron } from "./cron";

const TASKS_FILE = "scheduled-tasks.json";

function getTasksPath(): string {
  return join(getAgentDir(), TASKS_FILE);
}

export async function readTasks(): Promise<ScheduledTask[]> {
  try {
    const raw = await readFile(getTasksPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ScheduledTasksFile>;
    if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks;
    return [];
  } catch {
    return [];
  }
}

export async function writeTasks(tasks: ScheduledTask[]): Promise<void> {
  const dir = getAgentDir();
  await mkdir(dir, { recursive: true });
  const payload: ScheduledTasksFile = { tasks };
  await writeFile(getTasksPath(), JSON.stringify(payload, null, 2), "utf-8");
}

export function computeNextRun(schedule: TaskSchedule, from: Date = new Date()): string {
  if (schedule.type === "interval") {
    const everyMs = Math.max(1, schedule.everyMinutes) * 60_000;
    return new Date(from.getTime() + everyMs).toISOString();
  }
  if (schedule.type === "cron") {
    const next = nextCronRun(schedule.expression, from);
    if (next) return next.toISOString();
    const fallback = new Date(from.getTime() + 24 * 60 * 60_000);
    return fallback.toISOString();
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(schedule.time ?? "");
  if (!match) {
    const fallback = new Date(from.getTime() + 24 * 60 * 60_000);
    return fallback.toISOString();
  }
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  const target = new Date(from);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= from.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.toISOString();
}

export { validateCron };

export function fillMissingNextRun(tasks: ScheduledTask[]): { tasks: ScheduledTask[]; changed: boolean } {
  let changed = false;
  const next = tasks.map((t) => {
    if (t.nextRunAt === null || t.nextRunAt === undefined) {
      changed = true;
      return { ...t, nextRunAt: computeNextRun(t.schedule) };
    }
    return t;
  });
  return { tasks: next, changed };
}
