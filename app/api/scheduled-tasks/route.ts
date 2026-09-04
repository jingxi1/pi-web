import { NextResponse } from "next/server";
import { readTasks, writeTasks } from "@/lib/scheduled-tasks-store";
import { isTaskRunning } from "@/lib/scheduled-tasks-runner";
import type { ScheduledTask, TaskSchedule, TaskModelRef } from "@/lib/scheduled-tasks-types";
import { createTaskId } from "@/lib/scheduled-tasks-types";

export const dynamic = "force-dynamic";

/** GET — list tasks plus server time so the client can align nextRunAt. */
export async function GET() {
  const tasks = readTasks();
  return NextResponse.json({ tasks, serverTime: new Date().toISOString() });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeSchedule(raw: unknown): TaskSchedule | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const type = obj.type;
  switch (type) {
    case "interval": {
      const m = obj.everyMinutes;
      if (typeof m !== "number" || !Number.isFinite(m) || m < 1) return null;
      return { type: "interval", everyMinutes: Math.floor(m) };
    }
    case "daily": {
      const t = obj.time;
      if (typeof t !== "string" || !/^\d{1,2}:\d{2}$/.test(t)) return null;
      const [h, mm] = t.split(":").map(Number);
      if (Number.isNaN(h) || Number.isNaN(mm) || h > 23 || mm > 59) return null;
      return { type: "daily", time: `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
    }
    case "cron": {
      const e = obj.expression;
      if (typeof e !== "string" || e.trim().split(/\s+/).length !== 5) return null;
      return { type: "cron", expression: e.trim() };
    }
    default:
      return null;
  }
}

function normalizeModel(raw: unknown): TaskModelRef | null {
  const obj = asObject(raw);
  if (!obj) return null;
  if (typeof obj.provider !== "string" || typeof obj.modelId !== "string") return null;
  if (!obj.provider || !obj.modelId) return null;
  return { provider: obj.provider, modelId: obj.modelId };
}

/** Build a fresh task record from a (partial) POST body. */
function buildTask(body: unknown, patch?: ScheduledTask): ScheduledTask {
  const obj = asObject(body) ?? {};
  const base = patch ?? ({
    id: createTaskId(),
    createdAt: new Date().toISOString(),
  } as ScheduledTask);

  const out: ScheduledTask = { ...base };

  if (typeof obj.name === "string") out.name = obj.name;
  if (typeof obj.prompt === "string") out.prompt = obj.prompt;
  if (obj.cwd !== undefined) out.cwd = typeof obj.cwd === "string" ? obj.cwd : undefined;
  if (obj.model !== undefined) {
    const model = normalizeModel(obj.model);
    out.model = model ? model : null;
  }
  if (obj.schedule !== undefined) {
    const schedule = normalizeSchedule(obj.schedule);
    if (schedule) out.schedule = schedule;
  }
  if (obj.enabled !== undefined) out.enabled = Boolean(obj.enabled);
  if (obj.email !== undefined) {
    const emailObj = asObject(obj.email);
    out.email = {
      enabled: Boolean(emailObj?.enabled),
      to: typeof emailObj?.to === "string" && emailObj.to ? emailObj.to : undefined,
    };
  }

  return out;
}

function validateTask(task: ScheduledTask): string | null {
  if (!task.name) return "name is required";
  if (!task.prompt) return "prompt is required";
  if (!task.schedule) return "schedule is required";
  return null;
}

/** POST — create a new scheduled task. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const task = buildTask(body);
  const error = validateTask(task);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  return NextResponse.json({ task }, { status: 201 });
}

/** PUT — update an existing task (409 while running). */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const obj = asObject(body);
  if (!obj) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const id = obj.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (isTaskRunning(id)) {
    return NextResponse.json(
      { error: "Task is running and cannot be updated" },
      { status: 409 }
    );
  }

  const tasks = readTasks();
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const updated = buildTask(body, tasks[index]);
  const error = validateTask(updated);
  if (error) return NextResponse.json({ error }, { status: 400 });
  tasks[index] = updated;
  writeTasks(tasks);
  return NextResponse.json({ task: updated });
}
