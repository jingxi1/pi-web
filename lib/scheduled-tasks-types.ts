export type ScheduleType = "interval" | "daily" | "cron";

export interface TaskScheduleInterval {
  type: "interval";
  everyMinutes: number;
}

export interface TaskScheduleDaily {
  type: "daily";
  time: string;
}

export interface TaskScheduleCron {
  type: "cron";
  expression: string;
}

export type TaskSchedule = TaskScheduleInterval | TaskScheduleDaily | TaskScheduleCron;

export interface TaskModel {
  provider: string;
  modelId: string;
}

export interface TaskEmail {
  enabled: boolean;
  to?: string;
}

export interface TaskRunRecord {
  at: string;
  status: "success" | "error";
  summary: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  model: TaskModel | null;
  schedule: TaskSchedule;
  enabled: boolean;
  email: TaskEmail;
  lastRunAt: string | null;
  lastStatus: "success" | "error" | null;
  lastResult: string | null;
  nextRunAt: string | null;
  history: TaskRunRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTasksFile {
  tasks: ScheduledTask[];
}

export interface RunTaskResult {
  status: "success" | "error";
  text: string;
  durationMs: number;
  errorMessage?: string;
}

export const HISTORY_LIMIT = 20;
export const RESULT_PREVIEW_CHARS = 4000;
