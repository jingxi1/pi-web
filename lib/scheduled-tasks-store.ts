import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDataDir } from "./agent-data-dir";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { nextCronRun } from "./cron";
import type { ScheduledTask, TaskSchedule } from "./scheduled-tasks-types";

export function getTasksPath(): string {
  return join(getAgentDataDir(), "scheduled-tasks.json");
}

/** Read tasks from disk; any parse error yields an empty list. */
export function readTasks(): ScheduledTask[] {
  try {
    const raw = readFileSync(getTasksPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist tasks atomically. */
export function writeTasks(tasks: ScheduledTask[]): void {
  mkdirSync(getAgentDataDir(), { recursive: true });
  writePrivateFileAtomicSync(getTasksPath(), JSON.stringify(tasks, null, 2));
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Compute the next run time for a schedule from `from` (exclusive of "now"). */
export function computeNextRun(schedule: TaskSchedule, from: Date = new Date()): Date {
  switch (schedule.type) {
    case "interval": {
      return new Date(from.getTime() + schedule.everyMinutes * 60_000);
    }
    case "daily": {
      const target = timeToMinutes(schedule.time);
      const current = from.getHours() * 60 + from.getMinutes();
      const next = new Date(from);
      next.setSeconds(0, 0);
      next.setMilliseconds(0);
      next.setHours(0, Math.min(target, 1439), 0, 0);
      if (target <= current) next.setDate(next.getDate() + 1);
      return next;
    }
    case "cron": {
      return nextCronRun(schedule.expression, from);
    }
  }
}
