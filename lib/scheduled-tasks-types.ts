/**
 * Types for the scheduled-automation system that runs recurring prompts inside
 * the pi agent and optionally emails the result.
 */

export type TaskSchedule =
  | { type: "interval"; everyMinutes: number }
  | { type: "daily"; time: string } // "HH:MM"
  | { type: "cron"; expression: string }; // 5-field cron

export interface TaskModelRef {
  provider: string;
  modelId: string;
}

export interface TaskRunRecord {
  status: "success" | "error";
  ranAt: string; // ISO 8601
  durationMs: number;
  text: string;
  errorMessage?: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cwd?: string;
  model?: TaskModelRef | null;
  schedule: TaskSchedule;
  enabled: boolean;
  email?: { enabled: boolean; to?: string };
  nextRunAt?: string | null; // ISO 8601; null when disabled or not yet computed
  createdAt?: string;
  lastRunAt?: string | null;
  lastResult?: TaskRunRecord | null;
}

export function createTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
